/* global console */
import path from "node:path";
import { mkdtemp, rm, cp, mkdir } from "node:fs/promises";
import { assertActionSmoke } from "./assert-action-smoke.mjs";
import {
  ROOT,
  cleanupRepoRootNoise,
  closeFixtureServer,
  ensureRepoBuild,
  readActionRunBlock,
  runChecked,
  startFixtureServer
} from "./_shared.mjs";

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
    const runBlock = readActionRunBlock();

    await runChecked("bash", ["-lc", runBlock], {
      cwd: ROOT,
      env: {
        GITHUB_ACTION_PATH: ROOT,
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: githubOutputPath,
        INPUT_URL: fixture.url,
        INPUT_CONFIG: "tests/fixtures/integration-config.json",
        INPUT_POLICY: "tests/fixtures/policies/action-relative-policy.json",
        INPUT_BASELINE: ".tmp-action-baselines",
        INPUT_A11Y: "false",
        INPUT_PERF: "false",
        INPUT_VISUAL: "false",
        INPUT_ALLOW_INTERNAL: "true",
        INPUT_HEADERS: "",
        INPUT_COOKIES: "",
        CI: "false",
        GITHUB_ACTIONS: "false"
      }
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
