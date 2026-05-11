import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
// @ts-expect-error -- CI helper script is tested via its runtime ESM entrypoint.
import { cleanupRepoRootNoise, closeFixtureServer, ensureRepoBuild, startFixtureServer } from "../scripts/ci/_shared.mjs";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const TEST_CONFIG = path.join(ROOT, "tests", "fixtures", "integration-config.json");
const SUMMARY_SCHEMA = path.join(ROOT, "schemas", "summary.v1.json");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
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

function extractExitStatus(error: {
  code?: number | string;
  status?: number;
}): number {
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
  timeout: number = 60000,
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
  let cliPath = path.join(ROOT, "dist", "cli.js");
  let cliSnapshotRoot: string | undefined;

  function buildAuditArgs(extraArgs: string[] = []): string[] {
    return buildAuditArgsWithOut(outDir, extraArgs);
  }

  function buildAuditArgsWithOut(targetOutDir: string, extraArgs: string[] = []): string[] {
    return [
      "audit",
      baseUrl,
      "--out", targetOutDir,
      "--no-fail-on-a11y",
      "--no-fail-on-perf",
      "--no-fail-on-visual",
      "--config", TEST_CONFIG,
      "--baseline-dir", path.join(targetOutDir, "baselines"),
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
    await cp(path.join(ROOT, "configs"), path.join(cliSnapshotRoot, "configs"), { recursive: true });
    await cp(path.join(ROOT, "schemas"), path.join(cliSnapshotRoot, "schemas"), { recursive: true });
    await cp(path.join(ROOT, "package.json"), path.join(cliSnapshotRoot, "package.json"));
    cliPath = path.join(cliSnapshotRoot, "dist", "cli.js");

    const fixture = await startFixtureServer();
    server = fixture.server;
    baseUrl = fixture.url;
    // Create temp dir inside the project root so it passes validateOutputDirectory
    outDir = await mkdtemp(path.join(ROOT, ".tmp-int-"));
  }, 30000);

  afterAll(async () => {
    if (server) {
      await closeFixtureServer(server);
    }
    if (outDir) {
      await rm(outDir, { recursive: true, force: true });
    }
    if (cliSnapshotRoot) {
      await rm(cliSnapshotRoot, { recursive: true, force: true });
    }
  });

  it("produces valid summary.json with expected schema", async () => {
    // Run the CLI against the local fixture server. Default/html mode should
    // write artifacts without printing markdown/json payloads to stdout.
    const run = await runCli(cliPath, buildAuditArgs(), 60000);
    expect(run.status).toBe(0);
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
    expect(summary.toolVersion).toMatch(/^\d+\.\d+\.\d+$/);
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
  }, 90000);

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
    expect(run.stderr).toContain("Invalid format: xml. Use json, html, or md");
  }, 15000);

  it("returns exit code 2 for malformed --header input", async () => {
    const run = await runCli(cliPath, ["audit", baseUrl, "--header", "Authorization token"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      'Invalid --header value: Authorization token. Expected "Name: Value", for example --header "Authorization: Bearer <token>".'
    );
  }, 15000);

  it("returns exit code 2 for malformed --cookie input", async () => {
    const run = await runCli(cliPath, ["audit", baseUrl, "--cookie", "session"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      'Invalid --cookie value: session. Expected "name=value", for example --cookie "session_id=abc123".'
    );
  }, 15000);

  it("prints v1 JSON summary to stdout for --format json", async () => {
    const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-json-"));
    const modeOutDir = path.join(modeRoot, "artifacts");

    try {
      const run = await runCli(cliPath, buildAuditArgsWithOut(modeOutDir, ["--format", "json"]), 60000);
      expect(run.status).toBe(0);
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
  }, 90000);

  it("prints markdown summary to stdout for --format md", async () => {
    const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-md-"));
    const modeOutDir = path.join(modeRoot, "artifacts");

    try {
      const run = await runCli(cliPath, buildAuditArgsWithOut(modeOutDir, ["--format", "md"]), 60000);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("# Web Quality Gatekeeper Report");
      expect(run.stdout).toContain("| Step | Status | Badge |");
      expect(() => JSON.parse(run.stdout)).toThrow();

      expect(existsSync(path.join(modeOutDir, "summary.json"))).toBe(true);
      expect(existsSync(path.join(modeOutDir, "summary.v2.json"))).toBe(true);
      expect(existsSync(path.join(modeOutDir, "report.html"))).toBe(true);
    } finally {
      await rm(modeRoot, { recursive: true, force: true });
    }
  }, 90000);

  it("keeps stdout clean and writes html report for --format html", async () => {
    const modeRoot = await mkdtemp(path.join(ROOT, ".tmp-int-format-html-"));
    const modeOutDir = path.join(modeRoot, "artifacts");

    try {
      const run = await runCli(cliPath, buildAuditArgsWithOut(modeOutDir, ["--format", "html"]), 60000);
      expect(run.status).toBe(0);
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
  }, 90000);

  it("prints version with --version flag", () => {
    const output = execFileSync("node", [cliPath, "--version"], {
      cwd: ROOT,
      timeout: 15000,
      encoding: "utf8",
    });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 20000);

  it("report.html contains expected heading", async () => {
    // Re-use the output from the first test if still present
    const reportPath = path.join(outDir, "report.html");
    if (!existsSync(reportPath)) {
      return; // skip if prior test didn't run
    }
    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("Web Quality Gatekeeper");
  });

  it("blocks internal targets in CI mode unless explicit override is provided", async () => {
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
        path.join(outDir, "baselines")
      ],
      60000,
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
        path.join(outDir, "baselines"),
        "--allow-internal-targets"
      ],
      60000,
      { CI: "true", GITHUB_ACTIONS: "true" }
    );
    expect(overridden.status).toBe(0);
  }, 90000);

  it("supports config-driven multi-target audits and emits aggregate v2 pages", async () => {
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
        90000
      );

      expect(run.status).toBe(0);

      const summaryV2Path = path.join(multiOutDir, "summary.v2.json");
      const reportPath = path.join(multiOutDir, "report.html");
      expect(existsSync(summaryV2Path), "summary.v2.json should exist").toBe(true);
      expect(existsSync(reportPath), "report.html should exist").toBe(true);

      const summaryV2 = JSON.parse(await readFile(summaryV2Path, "utf8")) as {
        mode: string;
        pages: Array<{ name: string; url: string; artifacts: { summaryV2: string } }>;
        rollup: { pageCount: number };
      };

      expect(summaryV2.mode).toBe("multi");
      expect(summaryV2.rollup.pageCount).toBe(2);
      expect(summaryV2.pages.map((page) => page.name)).toEqual(["landing", "pricing"]);
      expect(summaryV2.pages.map((page) => page.url)).toEqual([
        `${baseUrl}/`,
        `${baseUrl}/pricing.html`
      ]);
      expect(summaryV2.pages.every((page) => page.artifacts.summaryV2.endsWith("summary.v2.json"))).toBe(
        true
      );

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
  }, 90000);

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

  it("emits trend artifacts and transitions from no_previous to ready across repeated CLI runs", async () => {
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

      const firstRun = await runCli(cliPath, args, 90000);
      expect(firstRun.status).toBe(0);

      const firstSummaryV2 = JSON.parse(
        await readFile(path.join(trendOutDir, "summary.v2.json"), "utf8")
      ) as { trend: { status: string }; artifacts: { trendHistoryJson: string | null; trendDashboardHtml: string | null } };
      expect(firstSummaryV2.trend.status).toBe("no_previous");
      expect(firstSummaryV2.artifacts.trendHistoryJson).toBe("trends/history.json");
      expect(firstSummaryV2.artifacts.trendDashboardHtml).toBe("trends/dashboard.html");
      expect(existsSync(path.join(trendOutDir, "trends", "history.json"))).toBe(true);
      expect(existsSync(path.join(trendOutDir, "trends", "dashboard.html"))).toBe(true);

      const secondRun = await runCli(cliPath, args, 90000);
      expect(secondRun.status).toBe(0);

      const secondSummaryV2 = JSON.parse(
        await readFile(path.join(trendOutDir, "summary.v2.json"), "utf8")
      ) as { trend: { status: string; history: { points: unknown[] } | null } };
      expect(secondSummaryV2.trend.status).toBe("ready");
      expect(secondSummaryV2.trend.history?.points.length).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(trendRoot, { recursive: true, force: true });
    }
  }, 180000);
});
