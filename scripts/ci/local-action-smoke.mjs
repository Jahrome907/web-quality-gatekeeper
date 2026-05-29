/* global console, process */
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, cp, mkdir } from "node:fs/promises";
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
        new Error(`Command failed: bash${stderr.trim() ? `\n${stderr.trim()}` : stdout.trim() ? `\n${stdout.trim()}` : ""}`)
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

function hasActionBrowser() {
  const bashCommand = resolveBashCommand();
  if (!bashCommand || !hasActionBash()) {
    return false;
  }

  return (
    spawnSync(
      bashCommand,
      [
        "-lc",
        "node -e \"const fs=require('node:fs');if(process.env.CHROME_PATH&&fs.existsSync(process.env.CHROME_PATH))process.exit(0);const { chromium } = require('playwright');process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)\""
      ],
      {
        cwd: ROOT,
        stdio: "ignore"
      }
    ).status === 0
  );
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
  let fixtureServer = null;

  try {
    await ensureRepoBuild();

    await mkdir(path.join(workspace, "tests"), { recursive: true });
    await cp(path.join(ROOT, "tests", "fixtures"), path.join(workspace, "tests", "fixtures"), {
      recursive: true
    });

    const fixture = await startFixtureServer();
    fixtureServer = fixture.server;

    const githubOutputPath = path.join(workspace, "github-output.txt");
    const envPrelude = [
      ["GITHUB_ACTION_PATH", ROOT],
      ["GITHUB_WORKSPACE", workspace],
      ["GITHUB_OUTPUT", githubOutputPath],
      ["INPUT_URL", fixture.url],
      ["INPUT_CONFIG", "tests/fixtures/integration-config.json"],
      ["INPUT_POLICY", "tests/fixtures/policies/action-relative-policy.json"],
      ["INPUT_BASELINE", ".tmp-action-baselines"],
      ["INPUT_A11Y", "false"],
      ["INPUT_PERF", "false"],
      ["INPUT_VISUAL", "false"],
      ["INPUT_ALLOW_INTERNAL", "true"],
      ["INPUT_HEADERS", ""],
      ["INPUT_COOKIES", ""],
      ["CI", "false"],
      ["GITHUB_ACTIONS", "false"]
    ]
      .map(([key, value]) => `export ${key}=${toBashLiteral(value)}`)
      .join("\n");
    const runBlock = `${envPrelude}\n${readActionRunBlock()}`;

    await runBashScript(runBlock, {
      cwd: ROOT
    });

    assertActionSmoke({ workspace, schemaRoot: ROOT, expectA11ySkipped: false });
    console.log("Local action smoke completed.");
  } finally {
    if (fixtureServer) {
      await closeFixtureServer(fixtureServer);
    }
    await rm(workspace, { recursive: true, force: true });
  }
}

runLocalActionSmoke();
