#!/usr/bin/env node
/* global console, process */
import path from "node:path";
import { existsSync } from "node:fs";
import {
  closeFixtureServer,
  FIXTURE_DIR,
  ROOT,
  runChecked,
  startFixtureServer
} from "./_shared.mjs";

function resolveCliCommand() {
  const builtCli = path.join(ROOT, "dist", "cli.js");
  const tsxBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx"
  );

  if (existsSync(tsxBin)) {
    return { command: tsxBin, args: [path.join(ROOT, "src", "cli.ts")] };
  }
  if (existsSync(builtCli)) {
    return { command: process.execPath, args: [builtCli] };
  }

  throw new Error(
    "Unable to locate a runnable CLI. Install dependencies with `npm ci` or run `npm run build`."
  );
}

const { command, args } = resolveCliCommand();
let fixtureServer;

try {
  const fixture = await startFixtureServer(FIXTURE_DIR);
  fixtureServer = fixture.server;

  await runChecked(
    command,
    [
      ...args,
      "audit",
      fixture.url,
      "--config",
      path.join(ROOT, "tests", "fixtures", "integration-config.json"),
      "--out",
      path.join(ROOT, "artifacts", "audit-ci"),
      "--baseline-dir",
      path.join(ROOT, "baselines", "audit-ci"),
      "--allow-internal-targets",
      "--no-fail-on-a11y",
      "--no-fail-on-perf",
      "--no-fail-on-visual"
    ],
    {
      env: {
        CI: "true",
        GITHUB_ACTIONS: "false"
      },
      timeout: 300000
    }
  );

  console.log("audit:ci completed.");
} finally {
  if (fixtureServer) {
    await closeFixtureServer(fixtureServer);
  }
}
