#!/usr/bin/env node
/* global console, process */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { closeFixtureServer, FIXTURE_DIR, ROOT, runChecked, startFixtureServer } from "../ci/_shared.mjs";

function usage() {
  console.error(
    "Usage: node scripts/case-study/run-fixture-case-study.mjs [--out-dir <dir>] [--config <path>] [--port <port>]"
  );
}

function parseArgs(argv) {
  const options = {
    outDir: path.join(ROOT, "artifacts", "case-study", "fixture"),
    configPath: path.join(ROOT, "tests", "fixtures", "integration-config.json"),
    port: 0
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--out-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --out-dir");
      }
      options.outDir = path.resolve(ROOT, value);
      index += 1;
      continue;
    }
    if (token === "--port") {
      const value = argv[index + 1];
      const port = Number(value);
      if (!value || value.startsWith("--") || !Number.isInteger(port) || port < 0) {
        throw new Error(`Invalid --port value: ${value ?? ""}`);
      }
      options.port = port;
      index += 1;
      continue;
    }
    if (token === "--config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("Missing value for --config");
      }
      options.configPath = path.resolve(ROOT, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function resolveCliCommand() {
  const builtCli = path.join(ROOT, "dist", "cli.js");
  const preferBuiltCli = process.env.WQG_CASE_STUDY_USE_DIST === "true";

  if (preferBuiltCli) {
    if (!existsSync(builtCli)) {
      throw new Error(
        "WQG_CASE_STUDY_USE_DIST=true requires a built CLI at dist/cli.js. Run `npm run build` first or unset WQG_CASE_STUDY_USE_DIST."
      );
    }
    return {
      command: process.execPath,
      args: [builtCli]
    };
  }

  const tsxBin = path.join(
    ROOT,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsx.cmd" : "tsx"
  );
  if (existsSync(tsxBin)) {
    return {
      command: tsxBin,
      args: [path.join(ROOT, "src", "cli.ts")]
    };
  }

  if (existsSync(builtCli)) {
    return {
      command: process.execPath,
      args: [builtCli]
    };
  }

  throw new Error(
    "Unable to locate a runnable CLI. Install dev dependencies (`npm ci`) to use tsx, or run `npm run build` to generate dist/cli.js."
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function toRelativePathOrNull(filePath) {
  return existsSync(filePath) ? path.relative(ROOT, filePath) : null;
}

function buildManifest({
  url,
  outDir,
  configPath,
  command,
  summaryPath,
  reportPath,
  summary
}) {
  const page = Array.isArray(summary.pages) ? summary.pages[0] : null;
  const metrics = page?.details?.performance?.metrics ?? {};

  return {
    schemaVersion: "1.0.0",
    kind: "fixture-case-study-run",
    generatedAt: new Date().toISOString(),
    source: {
      type: "local-fixture",
      repoPath: "tests/fixtures/site",
      configPath: path.relative(ROOT, configPath),
      url
    },
    command,
    outputs: {
      outDir,
      summaryV2Path: path.relative(ROOT, summaryPath),
      reportPath: path.relative(ROOT, reportPath),
      lighthousePath: toRelativePathOrNull(path.join(outDir, "artifacts", "lighthouse.json")),
      actionPlanPath: toRelativePathOrNull(path.join(outDir, "artifacts", "action-plan.md")),
      screenshotPath: toRelativePathOrNull(path.join(outDir, "artifacts", "screenshots", "home.png"))
    },
    result: {
      overallStatus: String(summary.overallStatus ?? "unknown"),
      pageCount: Number(summary.rollup?.pageCount ?? 0),
      a11yViolations: Number(summary.rollup?.a11yViolations ?? 0),
      performanceBudgetFailures: Number(summary.rollup?.performanceBudgetFailures ?? 0),
      visualFailures: Number(summary.rollup?.visualFailures ?? 0),
      performanceScore:
        typeof metrics.performanceScore === "number" ? metrics.performanceScore : null,
      lcpMs: typeof metrics.lcpMs === "number" ? metrics.lcpMs : null
    }
  };
}

const options = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    console.error((error).message);
    process.exit(2);
  }
})();

const { command, args } = resolveCliCommand();
const artifactDir = path.join(options.outDir, "artifacts");
const baselineDir = path.join(options.outDir, "baselines");
const configPath = options.configPath;

let fixtureServer;

try {
  await mkdir(artifactDir, { recursive: true });
  await mkdir(baselineDir, { recursive: true });

  fixtureServer = await startFixtureServer(FIXTURE_DIR, { port: options.port });
  const targetUrl = fixtureServer.url;

  const auditArgs = [
    ...args,
    "audit",
    targetUrl,
    "--config",
    configPath,
    "--baseline-dir",
    baselineDir,
    "--out",
    artifactDir
  ];

  await runChecked(command, auditArgs, {
    env: {
      CI: "false",
      GITHUB_ACTIONS: "false",
      GITHUB_WORKSPACE: options.outDir
    }
  });

  const summaryPath = path.join(artifactDir, "summary.v2.json");
  const reportPath = path.join(artifactDir, "report.html");
  const summary = readJson(summaryPath);
  const manifest = buildManifest({
    url: targetUrl,
    outDir: options.outDir,
    configPath,
    command: `${command} ${auditArgs.join(" ")}`,
    summaryPath,
    reportPath,
    summary
  });

  const manifestPath = path.join(options.outDir, "fixture-provenance.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`Fixture case study completed: ${path.relative(ROOT, options.outDir)}`);
  console.log(`- report: ${path.relative(ROOT, reportPath)}`);
  console.log(`- summary: ${path.relative(ROOT, summaryPath)}`);
  console.log(`- provenance: ${path.relative(ROOT, manifestPath)}`);
} finally {
  if (fixtureServer?.server) {
    await closeFixtureServer(fixtureServer.server);
  }
}
