/* global console, process */
import path from "node:path";
import { existsSync, statSync } from "node:fs";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, cp, mkdir, readFile } from "node:fs/promises";
import { assertActionSmoke } from "./assert-action-smoke.mjs";
import {
  ROOT,
  cleanupRepoRootNoise,
  closeFixtureServer,
  ensureRepoBuild,
  readActionRunBlock,
  startFixtureServer
} from "./_shared.mjs";

function resolveBashCommand() {
  if (process.env.WQG_ACTION_SMOKE_BASH) {
    const candidate = process.env.WQG_ACTION_SMOKE_BASH;
    if (
      (!path.isAbsolute(candidate) || existsSync(candidate)) &&
      spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0
    ) {
      return candidate;
    }
    return null;
  }

  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
          "bash"
        ]
      : ["bash"];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (path.isAbsolute(candidate) && !existsSync(candidate)) {
      continue;
    }
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }

  return null;
}

function runBashScript(script, options = {}) {
  const { cwd = ROOT, env = {} } = options;
  const bashCommand = resolveBashCommand();
  if (!bashCommand) {
    return Promise.reject(new Error("A working bash runtime is required for local action smoke."));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bashCommand, ["-lc", "bash -s"], {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: "1",
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed: bash${stderr.trim() ? `\n${stderr.trim()}` : stdout.trim() ? `\n${stdout.trim()}` : ""}`
        )
      );
    });

    child.stdin.end(`${script}\n`);
  });
}

function toBashLiteral(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function hasActionBash() {
  const bashCommand = resolveBashCommand();
  return Boolean(
    bashCommand &&
    spawnSync(bashCommand, ["-lc", "command -v node >/dev/null 2>&1"], {
      stdio: "ignore"
    }).status === 0
  );
}

const chromeCandidatesByPlatform = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ]
};

const pathExecutableNamesByPlatform = {
  darwin: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  linux: ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
  win32: ["chrome.exe", "msedge.exe", "brave.exe"]
};

function pathCandidates(names) {
  const searchPath = process.env.PATH ? process.env.PATH : "";
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  return directories.flatMap(function (directory) {
    return names.map(function (name) {
      return path.join(directory, name);
    });
  });
}
const browserVersionPattern =
  /\b(google chrome|chromium|chrome for testing|microsoft edge|brave browser)\b/i;

const trustedWindowsBrowserPaths = new Set(
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].map((candidate) => candidate.toLowerCase())
);

function isBrowserExecutableFile(candidate) {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      return false;
    }
    if (process.platform === "win32" && trustedWindowsBrowserPaths.has(candidate.toLowerCase())) {
      return true;
    }
    const output = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
      windowsHide: true
    });
    return browserVersionPattern.test(output);
  } catch {
    return false;
  }
}

function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    if (isBrowserExecutableFile(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
  }

  const platformCandidates = chromeCandidatesByPlatform[process.platform]
    ? chromeCandidatesByPlatform[process.platform]
    : [];
  const pathExecutableNames = pathExecutableNamesByPlatform[process.platform]
    ? pathExecutableNamesByPlatform[process.platform]
    : [];
  const executableCandidates = pathCandidates(pathExecutableNames);
  return (
    executableCandidates.concat(platformCandidates).find(function (candidate) {
      return isBrowserExecutableFile(candidate);
    }) || ""
  );
}
function hasActionBrowser() {
  const bashCommand = resolveBashCommand();
  if (!bashCommand || !hasActionBash()) {
    return false;
  }

  const chromePath = resolveChromePath();
  return (
    spawnSync(
      bashCommand,
      [
        "-lc",
        "node -e \"const fs=require('node:fs');if(process.env.CHROME_PATH&&fs.existsSync(process.env.CHROME_PATH))process.exit(0);const { chromium } = require('playwright');process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)\""
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          ...(chromePath ? { CHROME_PATH: chromePath } : {})
        },
        stdio: "ignore"
      }
    ).status === 0
  );
}

async function readGithubOutputs(filePath) {
  const source = await readFile(filePath, "utf8");
  const outputs = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }
    outputs.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return outputs;
}

function assertOutput(outputs, name, expected) {
  const actual = outputs.get(name);
  if (actual !== expected) {
    throw new Error(
      `Expected action output ${name} to be ${expected}, got ${actual ?? "<missing>"}`
    );
  }
}

async function runActionSetupPreflight(actionRoot, workspace) {
  const githubEnvPath = path.join(workspace, "github-env.txt");
  const envPrelude = [
    ["GITHUB_ACTION_PATH", actionRoot],
    ["GITHUB_WORKSPACE", workspace],
    ["GITHUB_ENV", githubEnvPath],
    ["CHROME_PATH", resolveChromePath()]
  ]
    .map(([key, value]) => `export ${key}=${toBashLiteral(value)}`)
    .join("\n");

  await runBashScript(
    `${envPrelude}\nnpm run engines:check\nnode scripts/ci/resolve-chrome-path.mjs`,
    {
      cwd: actionRoot
    }
  );
}

async function runActionAuditCase(params) {
  const {
    actionRoot,
    workspace,
    fixtureUrl,
    caseName,
    allowInternal = "false",
    headers = "",
    cookies = "",
    extraEnv = {},
    expectedSensitive
  } = params;
  const githubOutputPath = path.join(workspace, `github-output-${caseName}.txt`);
  const envPrelude = [
    ["GITHUB_ACTION_PATH", actionRoot],
    ["GITHUB_WORKSPACE", workspace],
    ["GITHUB_OUTPUT", githubOutputPath],
    ["INPUT_URL", fixtureUrl],
    ["INPUT_CONFIG", "tests/fixtures/integration-config.json"],
    ["INPUT_POLICY", "tests/fixtures/policies/action-relative-policy.json"],
    ["INPUT_BASELINE", `.tmp-action-baselines-${caseName}`],
    ["INPUT_A11Y", "false"],
    ["INPUT_PERF", "false"],
    ["INPUT_VISUAL", "false"],
    ["INPUT_ALLOW_INTERNAL", allowInternal],
    ["INPUT_HEADERS", headers],
    ["INPUT_COOKIES", cookies],
    ["CI", "false"],
    ["GITHUB_ACTIONS", "false"],
    ["CHROME_PATH", resolveChromePath()]
  ]
    .concat(Object.entries(extraEnv))
    .map(([key, value]) => `export ${key}=${toBashLiteral(value)}`)
    .join("\n");
  const runBlock = `${envPrelude}\n${readActionRunBlock()}`;

  await runBashScript(runBlock, {
    cwd: actionRoot
  });

  const outputs = await readGithubOutputs(githubOutputPath);
  const status = outputs.get("status");
  if (status !== "pass" && status !== "fail") {
    throw new Error(
      `Expected action output status to be pass or fail, got ${status ?? "<missing>"}`
    );
  }
  assertOutput(outputs, "sensitive-audit", expectedSensitive);
  assertOutput(outputs, "summary-path", "artifacts/summary.json");
  assertOutput(outputs, "summary-v2-path", "artifacts/summary.v2.json");
  assertOutput(outputs, "report-path", "artifacts/report.html");
  assertOutput(outputs, "action-plan-path", "artifacts/action-plan.md");
  assertOutput(outputs, "pr-risk-ledger-path", "artifacts/pr-risk-ledger.json");
  assertOutput(outputs, "pr-risk-ledger-md-path", "artifacts/pr-risk-ledger.md");

  return outputs;
}

async function runLocalActionSmoke() {
  if (!hasActionBrowser()) {
    const message =
      "Local action smoke requires a bash node runtime with CHROME_PATH or a Playwright browser installed.";
    if (process.env.WQG_ACTION_SMOKE_ALLOW_SKIP === "true") {
      console.log(`${message} Skipping because WQG_ACTION_SMOKE_ALLOW_SKIP=true.`);
      return;
    }
    throw new Error(`${message} Install the browser or rerun in a provisioned environment.`);
  }

  await cleanupRepoRootNoise({ scratchPrefixes: [".tmp-action-local-"] });
  const workspace = await mkdtemp(path.join(ROOT, ".tmp-action-local-"));
  const actionRoot = path.join(workspace, "action");
  let fixtureServer = null;

  try {
    await ensureRepoBuild();

    await mkdir(actionRoot, { recursive: true });
    await Promise.all([
      cp(path.join(ROOT, "dist"), path.join(actionRoot, "dist"), { recursive: true }),
      cp(path.join(ROOT, "configs"), path.join(actionRoot, "configs"), { recursive: true }),
      cp(path.join(ROOT, "schemas"), path.join(actionRoot, "schemas"), { recursive: true }),
      cp(path.join(ROOT, "scripts"), path.join(actionRoot, "scripts"), { recursive: true }),
      cp(path.join(ROOT, "package.json"), path.join(actionRoot, "package.json")),
      cp(path.join(ROOT, "action.yml"), path.join(actionRoot, "action.yml"))
    ]);

    await mkdir(path.join(workspace, "tests"), { recursive: true });
    await cp(path.join(ROOT, "tests", "fixtures"), path.join(workspace, "tests", "fixtures"), {
      recursive: true
    });

    await runActionSetupPreflight(actionRoot, workspace);

    const fixture = await startFixtureServer();
    fixtureServer = fixture.server;

    const defaultOutputs = await runActionAuditCase({
      actionRoot,
      workspace,
      fixtureUrl: fixture.url,
      caseName: "default",
      expectedSensitive: "false"
    });
    await runActionAuditCase({
      actionRoot,
      workspace,
      fixtureUrl: fixture.url,
      caseName: "sensitive",
      allowInternal: "true",
      headers: "X-WQG-Auth: local-action-smoke",
      cookies: "wqg_session=local-action-smoke",
      expectedSensitive: "true"
    });
    await runActionAuditCase({
      actionRoot,
      workspace,
      fixtureUrl: fixture.url,
      caseName: "env-internal",
      extraEnv: { WQG_ALLOW_INTERNAL_TARGETS: "true" },
      expectedSensitive: "true"
    });
    await runActionAuditCase({
      actionRoot,
      workspace,
      fixtureUrl: fixture.url,
      caseName: "append-env-auth",
      allowInternal: "true",
      extraEnv: {
        WQG_AUTH_HEADERS_APPEND: "X-WQG-Auth: append-env-smoke",
        WQG_AUTH_COOKIES_APPEND: "wqg_append_session=append-env-smoke"
      },
      expectedSensitive: "true"
    });

    assertActionSmoke({
      workspace,
      schemaRoot: actionRoot,
      summaryPath: defaultOutputs.get("summary-path"),
      summaryV2Path: defaultOutputs.get("summary-v2-path"),
      reportPath: defaultOutputs.get("report-path"),
      actionPlanPath: defaultOutputs.get("action-plan-path"),
      prRiskLedgerPath: defaultOutputs.get("pr-risk-ledger-path"),
      prRiskLedgerMarkdownPath: defaultOutputs.get("pr-risk-ledger-md-path"),
      expectA11ySkipped: false
    });
    console.log("Local action smoke completed.");
  } finally {
    if (fixtureServer) {
      await closeFixtureServer(fixtureServer);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

runLocalActionSmoke();
