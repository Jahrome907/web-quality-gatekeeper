import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import {
  cleanupRepoRootNoise,
  closeFixtureServer,
  ensureRepoBuild,
  startFixtureServer
} from "../scripts/ci/_shared.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const TEST_CONFIG = path.join(ROOT, "tests", "fixtures", "integration-config.json");
const SUMMARY_SCHEMA = path.join(ROOT, "schemas", "summary.v1.json");
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const AUDIT_RUN_TIMEOUT_MS = 120000;
const LONG_AUDIT_RUN_TIMEOUT_MS = 180000;
const AUDIT_TEST_TIMEOUT_MS = 180000;
const MULTI_AUDIT_TEST_TIMEOUT_MS = 300000;

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function truncateForAssertion(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...<truncated ${value.length - maxLength} chars>`;
}

function normalizeOutput(output: string | Buffer | null | undefined): string {
  if (typeof output === "string") {
    return output;
  }
  if (output instanceof Buffer) {
    return output.toString("utf8");
  }
  return "";
}

function extractExitStatus(error: { code?: number | string; status?: number }): number {
  if (typeof error.code === "number") {
    return error.code;
  }

  if (typeof error.code === "string" && /^\d+$/.test(error.code)) {
    return Number.parseInt(error.code, 10);
  }

  return error.status ?? 1;
}

async function runCli(
  cliPath: string,
  args: string[],
  timeout: number = AUDIT_RUN_TIMEOUT_MS,
  envOverrides: Record<string, string> = {}
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cliPath, ...args], {
      cwd: ROOT,
      timeout,
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
        // Keep fixture-based integration tests deterministic under GitHub Actions.
        CI: "false",
        GITHUB_ACTIONS: "false",
        ...envOverrides
      }
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const err = error as {
      code?: number | string;
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    return {
      status: extractExitStatus(err),
      stdout: normalizeOutput(err.stdout),
      stderr: normalizeOutput(err.stderr)
    };
  }
}

function expectCliSuccess(result: CliResult, context: string): void {
  expect(
    result.status,
    [
      `${context} failed with status ${result.status}.`,
      `stderr:\n${truncateForAssertion(result.stderr.trim() || "<empty>")}`,
      `stdout:\n${truncateForAssertion(result.stdout.trim() || "<empty>")}`
    ].join("\n\n")
  ).toBe(0);
}

function toV1CompatibilityShape(summary: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...summary };

  const a11y = summary.a11y as Record<string, unknown> | null | undefined;
  if (a11y && typeof a11y === "object") {
    normalized.a11y = {
      violations: a11y.violations,
      countsByImpact: a11y.countsByImpact,
      reportPath: a11y.reportPath
    };
  }

  const performance = summary.performance as Record<string, unknown> | null | undefined;
  if (performance && typeof performance === "object") {
    normalized.performance = {
      metrics: performance.metrics,
      budgets: performance.budgets,
      budgetResults: performance.budgetResults,
      reportPath: performance.reportPath
    };
  }

  return normalized;
}

describe("CLI integration", () => {
  let server: Server;
  let baseUrl: string;
  let outDir: string;
  let outputRoot: string;
  let cliPath = path.join(ROOT, "dist", "cli.js");
  let cliSnapshotRoot: string | undefined;

  function buildAuditArgs(extraArgs: string[] = []): string[] {
    return buildAuditArgsWithOut(outDir, extraArgs);
  }

  function buildAuditArgsWithOut(targetOutDir: string, extraArgs: string[] = []): string[] {
    return [
      "audit",
      baseUrl,
      "--out",
      targetOutDir,
      "--no-fail-on-a11y",
      "--no-fail-on-perf",
      "--no-fail-on-visual",
      "--config",
      TEST_CONFIG,
      "--baseline-dir",
      path.join(path.dirname(targetOutDir), "baselines"),
      ...extraArgs
    ];
  }

  beforeAll(async () => {
    await cleanupRepoRootNoise({ scratchPrefixes: [".tmp-int-", ".tmp-int-cli-"] });
    // Ensure CLI artifact is current for deterministic integration behavior.
    await ensureRepoBuild();
    // Snapshot the built package root so parallel smoke tests cannot mutate dist mid-run.
    cliSnapshotRoot = await mkdtemp(path.join(ROOT, ".tmp-int-cli-"));
    await cp(path.join(ROOT, "dist"), path.join(cliSnapshotRoot, "dist"), { recursive: true });
    await cp(path.join(ROOT, "configs"), path.join(cliSnapshotRoot, "configs"), {
      recursive: true
    });
    await cp(path.join(ROOT, "schemas"), path.join(cliSnapshotRoot, "schemas"), {
      recursive: true
    });
    await cp(path.join(ROOT, "package.json"), path.join(cliSnapshotRoot, "package.json"));
    cliPath = path.join(cliSnapshotRoot, "dist", "cli.js");

    const fixture = await startFixtureServer();
    server = fixture.server;
    baseUrl = fixture.url;
    // Create temp dir inside the project root so it passes validateOutputDirectory
    outputRoot = await mkdtemp(path.join(ROOT, ".tmp-int-"));
    outDir = path.join(outputRoot, "artifacts");
  }, 30000);

  afterAll(async () => {
    if (server) {
      await closeFixtureServer(server);
    }
    if (outputRoot) {
      await rm(outputRoot, { recursive: true, force: true });
    }
    if (cliSnapshotRoot) {
      await rm(cliSnapshotRoot, { recursive: true, force: true });
    }
  });

  it(
    "produces valid summary.json with expected schema",
    async () => {
      // Run the CLI against the local fixture server. Default/html mode should
      // write artifacts without printing markdown/json payloads to stdout.
      const run = await runCli(cliPath, buildAuditArgs(), AUDIT_RUN_TIMEOUT_MS);
      expectCliSuccess(run, "CLI audit");
      expect(run.stdout.trim()).toBe("");

      // --- Assert artifact files exist ---
      const summaryPath = path.join(outDir, "summary.json");
      const reportPath = path.join(outDir, "report.html");
      const riskLedgerPath = path.join(outDir, "pr-risk-ledger.json");
      const riskLedgerMarkdownPath = path.join(outDir, "pr-risk-ledger.md");

      expect(existsSync(summaryPath), "summary.json should exist").toBe(true);
      expect(existsSync(reportPath), "report.html should exist").toBe(true);
      expect(existsSync(riskLedgerPath), "pr-risk-ledger.json should exist").toBe(true);
      expect(existsSync(riskLedgerMarkdownPath), "pr-risk-ledger.md should exist").toBe(true);

      // --- Assert summary JSON is valid and schema-correct ---
      const raw = await readFile(summaryPath, "utf8");
      const summary = JSON.parse(raw);
      const schema = JSON.parse(readFileSync(SUMMARY_SCHEMA, "utf8")) as object;
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile(schema);

      // Top-level fields
      expect(summary).toHaveProperty("schemaVersion");
      expect(summary).toHaveProperty("$schema");
      expect(summary).toHaveProperty("toolVersion");
      expect(summary.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
      expect(summary.toolVersion).toMatch(SEMVER_PATTERN);
      const v1CompatibleSummary = toV1CompatibilityShape(summary);
      expect(validate(v1CompatibleSummary), JSON.stringify(validate.errors, null, 2)).toBe(true);

      // Required shape
      expect(summary).toHaveProperty("overallStatus");
      expect(["pass", "fail"]).toContain(summary.overallStatus);
      expect(summary).toHaveProperty("url");
      expect(summary.url).toContain("127.0.0.1");
      expect(summary).toHaveProperty("startedAt");
      expect(new Date(summary.startedAt).toISOString()).toBe(summary.startedAt);
      expect(summary).toHaveProperty("durationMs");
      expect(typeof summary.durationMs).toBe("number");

      // Steps
      expect(summary.steps).toHaveProperty("playwright");
      expect(summary.steps).toHaveProperty("a11y");
      expect(summary.steps).toHaveProperty("perf");
      expect(summary.steps).toHaveProperty("visual");

      // Artifacts
      expect(summary.artifacts).toHaveProperty("summary", "summary.json");
      expect(summary.artifacts).toHaveProperty("report", "report.html");
      expect(summary.artifacts).toHaveProperty("screenshotsDir", "screenshots");

      const riskLedger = JSON.parse(await readFile(riskLedgerPath, "utf8"));
      expect(riskLedger).toHaveProperty("summaryPath", "summary.v2.json");
      expect(riskLedger).toHaveProperty("reportPath", "report.html");
      expect(riskLedger).toHaveProperty("entries");

      // Screenshots array
      expect(Array.isArray(summary.screenshots)).toBe(true);
      if (summary.screenshots.length > 0) {
        const shot = summary.screenshots[0];
        expect(shot).toHaveProperty("name");
        expect(shot).toHaveProperty("path");
        expect(shot).toHaveProperty("url");
        expect(shot).toHaveProperty("fullPage");
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "fails a real CLI audit when the final navigation response is HTTP 404",
    async () => {
      const missingOutDir = await mkdtemp(path.join(ROOT, ".tmp-int-http-status-"));

      try {
        const run = await runCli(
          cliPath,
          [
            "audit",
            `${baseUrl}/missingpath`,
            "--out",
            missingOutDir,
            "--no-fail-on-a11y",
            "--no-fail-on-visual",
            "--config",
            TEST_CONFIG,
            "--baseline-dir",
            `${missingOutDir}-baselines`
          ],
          AUDIT_RUN_TIMEOUT_MS
        );

        expect(run.status).toBe(1);
        expect(`${run.stderr}\n${run.stdout}`).toContain(
          `Browser navigation failed with HTTP 404 for ${baseUrl}/missingpath`
        );
      } finally {
        await Promise.all([
          rm(missingOutDir, { recursive: true, force: true }),
          rm(`${missingOutDir}-baselines`, { recursive: true, force: true })
        ]);
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "requires an explicit visual baseline, compares it, and reports a changed page",
    async () => {
      const visualRoot = await mkdtemp(path.join(ROOT, ".tmp-int-visual-lifecycle-"));
      const fixtureRoot = visualRoot;
      const fixturePath = path.join(fixtureRoot, "index.html");
      const configPath = path.join(visualRoot, "visual-config.json");
      const baselineDir = path.join(visualRoot, "baselines");
      let visualServer: Server | undefined;

      const renderFixture = (heading: string, background: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Visual lifecycle fixture</title>
    <style>
      body { margin: 0; background: ${background}; color: #172033; font-family: Arial, sans-serif; }
      main { box-sizing: border-box; min-height: 720px; padding: 80px; }
      h1 { font-size: 64px; max-width: 760px; }
    </style>
  </head>
  <body><main><h1>${heading}</h1></main></body>
</html>`;

      try {
        await writeFile(fixturePath, renderFixture("Stable visual baseline", "#e8f0ff"), "utf8");
        const visualConfig = {
          ...JSON.parse(await readFile(TEST_CONFIG, "utf8")),
          screenshots: [{ name: "fixture", path: "@target", fullPage: true }],
          visual: { threshold: 0 },
          toggles: { a11y: false, perf: false, visual: true }
        };
        await writeFile(configPath, JSON.stringify(visualConfig), "utf8");
        const fixture = await startFixtureServer(fixtureRoot);
        visualServer = fixture.server;

        const auditArgs = (targetOutDir: string, extraArgs: string[] = []) => [
          "audit",
          fixture.url,
          "--config",
          configPath,
          "--out",
          targetOutDir,
          "--baseline-dir",
          baselineDir,
          ...extraArgs
        ];

        const missingBaselineOutDir = path.join(visualRoot, "missing-baseline");
        const missingBaseline = await runCli(
          cliPath,
          auditArgs(missingBaselineOutDir),
          AUDIT_RUN_TIMEOUT_MS
        );
        expect(missingBaseline.status).toBe(1);
        expect(`${missingBaseline.stderr}\n${missingBaseline.stdout}`).toContain(
          "Visual baseline is missing for fixture. Run with --set-baseline after reviewing the screenshot."
        );
        expect(existsSync(baselineDir)).toBe(false);

        const setBaselineOutDir = path.join(visualRoot, "set-baseline");
        const setBaseline = await runCli(
          cliPath,
          auditArgs(setBaselineOutDir, ["--set-baseline"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(setBaseline, "CLI visual baseline setup");

        const setBaselineSummary = JSON.parse(
          await readFile(path.join(setBaselineOutDir, "summary.v2.json"), "utf8")
        ) as {
          pages: Array<{
            details: {
              screenshots: Array<{ path: string }>;
              visual: { failed: boolean; results: Array<{ status: string; baselinePath: string }> };
            };
          }>;
        };
        const setBaselineDetails = setBaselineSummary.pages[0]!.details;
        const screenshotPath = setBaselineDetails.screenshots[0]?.path;
        expect(screenshotPath).toBeTruthy();
        expect(existsSync(path.join(setBaselineOutDir, screenshotPath!))).toBe(true);
        expect(setBaselineDetails.visual.failed).toBe(false);
        expect(setBaselineDetails.visual.results[0]?.status).toBe("baseline_created");
        expect(existsSync(path.join(baselineDir, path.basename(screenshotPath!)))).toBe(true);

        const compareOutDir = path.join(visualRoot, "compare");
        const compare = await runCli(cliPath, auditArgs(compareOutDir), AUDIT_RUN_TIMEOUT_MS);
        expectCliSuccess(compare, "CLI visual comparison");
        const compareSummary = JSON.parse(
          await readFile(path.join(compareOutDir, "summary.v2.json"), "utf8")
        ) as {
          pages: Array<{
            details: {
              visual: {
                failed: boolean;
                results: Array<{ status: string; mismatchRatio: number }>;
              };
            };
          }>;
        };
        const compareVisual = compareSummary.pages[0]!.details.visual;
        expect(compareVisual.failed).toBe(false);
        expect(compareVisual.results[0]?.status).toBe("diffed");
        expect(compareVisual.results[0]?.mismatchRatio).toBe(0);

        await writeFile(fixturePath, renderFixture("Changed visual page", "#ff5a36"), "utf8");
        const changedOutDir = path.join(visualRoot, "changed");
        const changed = await runCli(cliPath, auditArgs(changedOutDir), AUDIT_RUN_TIMEOUT_MS);
        expect(changed.status).toBe(1);
        const changedSummary = JSON.parse(
          await readFile(path.join(changedOutDir, "summary.v2.json"), "utf8")
        ) as {
          pages: Array<{
            details: {
              visual: {
                failed: boolean;
                results: Array<{ mismatchRatio: number; diffPath: string | null }>;
              };
            };
          }>;
        };
        const changedVisual = changedSummary.pages[0]!.details.visual;
        const changedResult = changedVisual.results[0];
        expect(changedVisual.failed).toBe(true);
        expect(changedResult?.mismatchRatio).toBeGreaterThan(0);
        expect(changedResult?.diffPath).toBeTruthy();
        expect(existsSync(path.join(changedOutDir, changedResult!.diffPath!))).toBe(true);
      } finally {
        if (visualServer) {
          await closeFixtureServer(visualServer);
        }
        await rm(visualRoot, { recursive: true, force: true });
      }
    },
    MULTI_AUDIT_TEST_TIMEOUT_MS
  );

  it("returns exit code 2 for invalid URL", async () => {
    const run = await runCli(cliPath, ["audit", "not-a-url"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Invalid URL");
    expect(run.stderr).toContain("Expected an absolute http:// or https:// URL");
  }, 15000);

  it("returns exit code 2 for unsupported URL protocols with actionable guidance", async () => {
    const run = await runCli(cliPath, ["audit", "ws://example.com/socket"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Invalid URL");
    expect(run.stderr).toContain("Use http:// or https:// URLs only.");
  }, 15000);

  it("returns exit code 2 for invalid --format", async () => {
    const run = await runCli(cliPath, ["audit", baseUrl, "--format", "xml"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      "Invalid format: xml. Use json, json-v2, html, md, pr-risk-ledger, action-plan"
    );
  }, 15000);

  it("returns exit code 2 for malformed --header input", async () => {
    const run = await runCli(cliPath, ["audit", baseUrl, "--header", "X-WQG-Auth token"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      'Invalid --header value. Expected "Name: Value", for example --header "X-WQG-Auth: Token <token>".'
    );
    expect(run.stderr).not.toContain("X-WQG-Auth token");
  }, 15000);

  it("returns exit code 2 for malformed --cookie input", async () => {
    const run = await runCli(cliPath, ["audit", baseUrl, "--cookie", "session"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      'Invalid --cookie value. Expected "name=value", for example --cookie "wqg_session=abc123".'
    );
  }, 15000);

  it(
    "prints v1 JSON summary to stdout for --format json",
    async () => {
      const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-json-"));
      const modeOutDir = path.join(modeRoot, "artifacts");

      try {
        const run = await runCli(
          cliPath,
          buildAuditArgsWithOut(modeOutDir, ["--format", "json"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(run, "CLI audit");
        const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
        expect(parsed).toHaveProperty("schemaVersion");
        expect(parsed).toHaveProperty("$schema");
        expect(parsed).toHaveProperty("overallStatus");
        expect(parsed).toHaveProperty("artifacts");

        expect(existsSync(path.join(modeOutDir, "summary.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "summary.v2.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "report.html"))).toBe(true);
      } finally {
        await rm(modeRoot, { recursive: true, force: true });
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "prints markdown summary to stdout for --format md",
    async () => {
      const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-md-"));
      const modeOutDir = path.join(modeRoot, "artifacts");

      try {
        const run = await runCli(
          cliPath,
          buildAuditArgsWithOut(modeOutDir, ["--format", "md"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(run, "CLI audit");
        expect(run.stdout).toContain("# Web Quality Gatekeeper Report");
        expect(run.stdout).toContain("| Step | Status | Badge |");
        expect(() => JSON.parse(run.stdout)).toThrow();

        expect(existsSync(path.join(modeOutDir, "summary.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "summary.v2.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "report.html"))).toBe(true);
      } finally {
        await rm(modeRoot, { recursive: true, force: true });
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "prints aggregate summary v2 JSON to stdout for --format json-v2",
    async () => {
      const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-json-v2-"));
      const modeOutDir = path.join(modeRoot, "artifacts");

      try {
        const run = await runCli(
          cliPath,
          buildAuditArgsWithOut(modeOutDir, ["--format", "json-v2"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(run, "CLI audit");
        const parsed = JSON.parse(run.stdout) as { schemaVersion?: string; pages?: unknown[] };
        expect(parsed.schemaVersion).toBe("2.3.0");
        expect(Array.isArray(parsed.pages)).toBe(true);

        expect(existsSync(path.join(modeOutDir, "summary.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "summary.v2.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "report.html"))).toBe(true);
      } finally {
        await rm(modeRoot, { recursive: true, force: true });
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "prints merge-review artifacts to stdout for focused scripting formats",
    async () => {
      const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-artifacts-"));
      const ledgerOutDir = path.join(modeRoot, "ledger");
      const actionPlanOutDir = path.join(modeRoot, "action-plan");

      try {
        const ledgerRun = await runCli(
          cliPath,
          buildAuditArgsWithOut(ledgerOutDir, ["--format", "pr-risk-ledger"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(ledgerRun, "CLI pr-risk-ledger audit");
        const ledger = JSON.parse(ledgerRun.stdout) as {
          schemaVersion?: string;
          entries?: unknown[];
        };
        expect(ledger.schemaVersion).toBe("1.0.0");
        expect(Array.isArray(ledger.entries)).toBe(true);

        const actionPlanRun = await runCli(
          cliPath,
          buildAuditArgsWithOut(actionPlanOutDir, ["--format", "action-plan"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(actionPlanRun, "CLI action-plan audit");
        expect(actionPlanRun.stdout).toContain("# Web Quality Gatekeeper Action Plan");
        expect(() => JSON.parse(actionPlanRun.stdout)).toThrow();
      } finally {
        await rm(modeRoot, { recursive: true, force: true });
      }
    },
    MULTI_AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "keeps stdout clean and writes html report for --format html",
    async () => {
      const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-html-"));
      const modeOutDir = path.join(modeRoot, "artifacts");

      try {
        const run = await runCli(
          cliPath,
          buildAuditArgsWithOut(modeOutDir, ["--format", "html"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(run, "CLI audit");
        expect(run.stdout.trim()).toBe("");

        const reportPath = path.join(modeOutDir, "report.html");
        expect(existsSync(reportPath)).toBe(true);
        expect(existsSync(path.join(modeOutDir, "summary.json"))).toBe(true);
        expect(existsSync(path.join(modeOutDir, "summary.v2.json"))).toBe(true);

        const html = await readFile(reportPath, "utf8");
        expect(html).toContain("<html");
        expect(html).toContain("Web Quality Gatekeeper");
      } finally {
        await rm(modeRoot, { recursive: true, force: true });
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it("prints version with --version flag", () => {
    const output = execFileSync("node", [cliPath, "--version"], {
      cwd: ROOT,
      timeout: 15000,
      encoding: "utf8"
    });
    expect(output.trim()).toMatch(SEMVER_PATTERN);
  }, 20000);

  it("runs doctor as a CLI with JSON diagnostics", async () => {
    const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-doctor-"));

    try {
      const run = await runCli(
        cliPath,
        [
          "doctor",
          "--config",
          TEST_CONFIG,
          "--out",
          path.join(modeRoot, "artifacts"),
          "--baseline-dir",
          path.join(modeRoot, "baselines"),
          "--json"
        ],
        15000,
        { CHROME_PATH: process.execPath }
      );

      expectCliSuccess(run, "CLI audit");
      const parsed = JSON.parse(run.stdout) as {
        status: string;
        checks: Array<{ id: string; status: string }>;
      };
      expect(parsed.status).not.toBe("fail");
      expect(parsed.checks.map((check) => check.id)).toContain("browser");
    } finally {
      await rm(modeRoot, { recursive: true, force: true });
    }
  }, 20000);

  it("lets doctor warnings stay non-blocking unless --strict is set", async () => {
    const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-doctor-strict-"));
    const args = [
      "doctor",
      "--config",
      TEST_CONFIG,
      "--out",
      path.join(modeRoot, "artifacts"),
      "--baseline-dir",
      path.join(modeRoot, "baselines")
    ];
    const env = {
      CHROME_PATH: process.execPath,
      WQG_VISUAL_DIFF_ENGINE: "native-rust"
    };

    try {
      const warningRun = await runCli(cliPath, args, 15000, env);
      expectCliSuccess(warningRun, "CLI doctor warning run");
      expect(warningRun.stdout).toContain("Status: WARN");

      const strictRun = await runCli(cliPath, [...args, "--strict"], 15000, env);
      expect(strictRun.status).toBe(1);
      expect(strictRun.stdout).toContain("Status: FAIL");
    } finally {
      await rm(modeRoot, { recursive: true, force: true });
    }
  }, 30000);

  it(
    "report.html contains expected heading",
    async () => {
      const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-report-heading-"));
      const modeOutDir = path.join(modeRoot, "artifacts");

      try {
        const run = await runCli(
          cliPath,
          buildAuditArgsWithOut(modeOutDir, ["--format", "html"]),
          AUDIT_RUN_TIMEOUT_MS
        );
        expectCliSuccess(run, "CLI audit");

        const reportPath = path.join(modeOutDir, "report.html");
        expect(existsSync(reportPath)).toBe(true);
        const html = await readFile(reportPath, "utf8");
        expect(html).toContain("Web Quality Gatekeeper");
      } finally {
        await rm(modeRoot, { recursive: true, force: true });
      }
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "blocks internal targets in CI mode unless explicit override is provided",
    async () => {
      const run = await runCli(
        cliPath,
        [
          "audit",
          baseUrl,
          "--out",
          outDir,
          "--config",
          TEST_CONFIG,
          "--baseline-dir",
          path.join(path.dirname(outDir), "baselines")
        ],
        AUDIT_RUN_TIMEOUT_MS,
        { CI: "true", GITHUB_ACTIONS: "true" }
      );

      expect(run.status).toBe(2);
      expect(run.stderr).toContain("Blocked internal target");

      const overridden = await runCli(
        cliPath,
        [
          "audit",
          baseUrl,
          "--out",
          outDir,
          "--config",
          TEST_CONFIG,
          "--baseline-dir",
          path.join(path.dirname(outDir), "baselines"),
          "--allow-internal-targets"
        ],
        AUDIT_RUN_TIMEOUT_MS,
        { CI: "true", GITHUB_ACTIONS: "true" }
      );
      expectCliSuccess(overridden, "CLI internal target override audit");
    },
    AUDIT_TEST_TIMEOUT_MS
  );

  it(
    "supports config-driven multi-target audits and emits aggregate v2 pages",
    async () => {
      const multiRoot = await mkdtemp(path.join(ROOT, ".tmp-int-multi-"));
      const multiOutDir = path.join(multiRoot, "artifacts");
      const multiConfigPath = path.join(multiRoot, "multi-target.config.json");

      try {
        const baseConfig = JSON.parse(readFileSync(TEST_CONFIG, "utf8")) as Record<string, unknown>;
        baseConfig.urls = [
          { name: "landing", url: baseUrl },
          { name: "pricing", url: `${baseUrl}/pricing.html` }
        ];

        await writeFile(multiConfigPath, JSON.stringify(baseConfig, null, 2), "utf8");

        const run = await runCli(
          cliPath,
          [
            "audit",
            "--config",
            multiConfigPath,
            "--out",
            multiOutDir,
            "--baseline-dir",
            path.join(multiRoot, "baselines"),
            "--no-fail-on-a11y",
            "--no-fail-on-perf",
            "--no-fail-on-visual",
            "--allow-internal-targets"
          ],
          LONG_AUDIT_RUN_TIMEOUT_MS
        );

        expectCliSuccess(run, "CLI audit");

        const summaryV2Path = path.join(multiOutDir, "summary.v2.json");
        const summaryPath = path.join(multiOutDir, "summary.json");
        const reportPath = path.join(multiOutDir, "report.html");
        expect(existsSync(summaryV2Path), "summary.v2.json should exist").toBe(true);
        expect(existsSync(summaryPath), "summary.json should exist").toBe(true);
        expect(existsSync(reportPath), "report.html should exist").toBe(true);

        const summaryV2 = JSON.parse(await readFile(summaryV2Path, "utf8")) as {
          mode: string;
          pages: Array<{
            name: string;
            url: string;
            artifacts: { summaryV2: string };
            details: { screenshots: Array<{ url: string; path: string }> };
          }>;
          artifacts: { prRiskLedgerJson: string; prRiskLedgerMd: string };
          rollup: { pageCount: number };
        };

        expect(summaryV2.mode).toBe("multi");
        expect(summaryV2.artifacts.prRiskLedgerJson).toBe("pr-risk-ledger.json");
        expect(summaryV2.artifacts.prRiskLedgerMd).toBe("pr-risk-ledger.md");
        expect(existsSync(path.join(multiOutDir, summaryV2.artifacts.prRiskLedgerJson))).toBe(true);
        expect(existsSync(path.join(multiOutDir, summaryV2.artifacts.prRiskLedgerMd))).toBe(true);
        expect(summaryV2.rollup.pageCount).toBe(2);
        expect(summaryV2.pages.map((page) => page.name)).toEqual(["landing", "pricing"]);
        expect(summaryV2.pages.map((page) => page.url)).toEqual([
          `${baseUrl}/`,
          `${baseUrl}/pricing.html`
        ]);
        expect(
          summaryV2.pages.every((page) => page.artifacts.summaryV2.endsWith("summary.v2.json"))
        ).toBe(true);
        expect(summaryV2.pages.map((page) => page.details.screenshots[0]?.url)).toEqual([
          `${baseUrl}/`,
          `${baseUrl}/pricing.html`
        ]);
        expect(summaryV2.pages.map((page) => page.details.screenshots[0]?.path)).toEqual([
          "pages/01-landing/screenshots/home.png",
          "pages/02-pricing/screenshots/home.png"
        ]);
        const summary = JSON.parse(await readFile(summaryPath, "utf8")) as {
          screenshots: Array<{ path: string }>;
          artifacts: { screenshotsDir: string };
          url: string;
        };
        expect(summary.url).toBe(`${baseUrl}/`);
        expect(summary.screenshots.map((shot) => shot.path)).toEqual([
          "pages/01-landing/screenshots/home.png"
        ]);
        expect(summary.artifacts.screenshotsDir).toBe("pages/01-landing/screenshots");

        const html = await readFile(reportPath, "utf8");
        expect(html).toContain("Aggregate report for 2 pages");
        expect(html).toContain("Target Coverage");
        expect(html).toContain("landing");
        expect(html).toContain("pricing");
        expect(html).toContain(`${baseUrl}/`);
        expect(html).toContain(`${baseUrl}/pricing.html`);
        expect(html).toContain("pill pass");
      } finally {
        await rm(multiRoot, { recursive: true, force: true });
      }
    },
    MULTI_AUDIT_TEST_TIMEOUT_MS
  );

  it("surfaces invalid config inheritance as a CLI failure instead of silently continuing", async () => {
    const invalidRoot = await mkdtemp(path.join(ROOT, ".tmp-int-invalid-config-"));
    const invalidOutDir = path.join(invalidRoot, "artifacts");
    const invalidConfigPath = path.join(invalidRoot, "invalid-extends.config.json");

    try {
      const baseConfig = JSON.parse(readFileSync(TEST_CONFIG, "utf8")) as Record<string, unknown>;
      baseConfig.extends = "policy:docs";

      await writeFile(invalidConfigPath, JSON.stringify(baseConfig, null, 2), "utf8");

      const run = await runCli(
        cliPath,
        [
          "audit",
          baseUrl,
          "--config",
          invalidConfigPath,
          "--out",
          invalidOutDir,
          "--baseline-dir",
          path.join(invalidRoot, "baselines")
        ],
        20000
      );

      expect(run.status).toBe(1);
      expect(run.stderr).toContain("extends");
    } finally {
      await rm(invalidRoot, { recursive: true, force: true });
    }
  }, 30000);

  it(
    "emits trend artifacts and transitions from no_previous to ready across repeated CLI runs",
    async () => {
      const trendRoot = await mkdtemp(path.join(ROOT, ".tmp-int-trend-"));
      const trendOutDir = path.join(trendRoot, "artifacts");
      const trendConfigPath = path.join(trendRoot, "trend.config.json");

      try {
        const baseConfig = JSON.parse(readFileSync(TEST_CONFIG, "utf8")) as Record<string, unknown>;
        baseConfig.trends = {
          enabled: true,
          historyDir: ".wqg-history",
          maxSnapshots: 5,
          dashboard: {
            window: 5
          }
        };

        await writeFile(trendConfigPath, JSON.stringify(baseConfig, null, 2), "utf8");

        const args = [
          "audit",
          baseUrl,
          "--config",
          trendConfigPath,
          "--out",
          trendOutDir,
          "--baseline-dir",
          path.join(trendRoot, "baselines"),
          "--no-fail-on-a11y",
          "--no-fail-on-perf",
          "--no-fail-on-visual",
          "--allow-internal-targets"
        ];

        const firstRun = await runCli(cliPath, args, LONG_AUDIT_RUN_TIMEOUT_MS);
        expectCliSuccess(firstRun, "CLI first trend audit");

        const firstSummaryV2 = JSON.parse(
          await readFile(path.join(trendOutDir, "summary.v2.json"), "utf8")
        ) as {
          trend: { status: string };
          artifacts: { trendHistoryJson: string | null; trendDashboardHtml: string | null };
        };
        expect(firstSummaryV2.trend.status).toBe("no_previous");
        expect(firstSummaryV2.artifacts.trendHistoryJson).toBe("trends/history.json");
        expect(firstSummaryV2.artifacts.trendDashboardHtml).toBe("trends/dashboard.html");
        expect(existsSync(path.join(trendOutDir, "trends", "history.json"))).toBe(true);
        expect(existsSync(path.join(trendOutDir, "trends", "dashboard.html"))).toBe(true);

        const secondRun = await runCli(cliPath, args, LONG_AUDIT_RUN_TIMEOUT_MS);
        expectCliSuccess(secondRun, "CLI second trend audit");

        const secondSummaryV2 = JSON.parse(
          await readFile(path.join(trendOutDir, "summary.v2.json"), "utf8")
        ) as { trend: { status: string; history: { points: unknown[] } | null } };
        expect(secondSummaryV2.trend.status).toBe("ready");
        expect(secondSummaryV2.trend.history?.points.length).toBeGreaterThanOrEqual(2);
      } finally {
        await rm(trendRoot, { recursive: true, force: true });
      }
    },
    MULTI_AUDIT_TEST_TIMEOUT_MS
  );
});
