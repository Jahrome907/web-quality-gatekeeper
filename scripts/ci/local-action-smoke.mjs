/* global console, process */
import path from "node:path";
import { spawn } from "node:child_process";
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

function runBashScript(script, options = {}) {
  const { cwd = ROOT, env = {} } = options;

  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", "bash -s"], {
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

async function runLocalActionSmoke() {
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
