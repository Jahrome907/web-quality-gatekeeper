import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const FIXTURE_DIR = path.join(ROOT, "tests", "fixtures", "site");
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

async function runCli(
  args: string[],
  timeout: number = 60000,
  envOverrides: Record<string, string> = {}
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI, ...args], {
      cwd: ROOT,
      timeout,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...envOverrides }
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const err = error as {
      code?: number | string;
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const status =
      typeof err.code === "number" ? err.code : (err.status ?? 1);
    return {
      status,
      stdout: normalizeOutput(err.stdout),
      stderr: normalizeOutput(err.stderr)
    };
  }
}

/**
 * Starts a static file server for the fixture site.
 * Avoids any external network dependency.
 */
function startFixtureServer(): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = path.join(FIXTURE_DIR, req.url === "/" ? "index.html" : req.url!);
      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath);
      const contentType = ext === ".html" ? "text/html" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(readFileSync(filePath));
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeFixtureServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
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
  let server: http.Server;
  let baseUrl: string;
  let outDir: string;

  function buildAuditArgs(extraArgs: string[] = []): string[] {
    return [
      "audit",
      baseUrl,
      "--out", outDir,
      "--no-fail-on-a11y",
      "--no-fail-on-perf",
      "--no-fail-on-visual",
      "--config", TEST_CONFIG,
      "--baseline-dir", path.join(outDir, "baselines"),
      ...extraArgs
    ];
  }

  beforeAll(async () => {
    // Ensure CLI artifact is current for deterministic integration behavior.
    execFileSync("npm", ["run", "build"], {
      cwd: ROOT,
      timeout: 120000,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: "pipe"
    });

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
  });

  it("produces valid summary.json with expected schema", async () => {
    // Run the CLI against the local fixture server. Default/html mode should
    // write artifacts without printing markdown/json payloads to stdout.
    const run = await runCli(buildAuditArgs(), 60000);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("");

    // --- Assert artifact files exist ---
    const summaryPath = path.join(outDir, "summary.json");
    const reportPath = path.join(outDir, "report.html");

    expect(existsSync(summaryPath), "summary.json should exist").toBe(true);
    expect(existsSync(reportPath), "report.html should exist").toBe(true);

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
    const run = await runCli(["audit", "not-a-url"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Invalid URL");
  }, 15000);

  it("returns exit code 2 for invalid --format", async () => {
    const run = await runCli(["audit", baseUrl, "--format", "xml"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Invalid format: xml. Use json, html, or md");
  }, 15000);

  it("returns exit code 2 for malformed --header input", async () => {
    const run = await runCli(["audit", baseUrl, "--header", "Authorization token"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      'Invalid --header value: Authorization token. Expected "Name: Value".'
    );
  }, 15000);

  it("returns exit code 2 for malformed --cookie input", async () => {
    const run = await runCli(["audit", baseUrl, "--cookie", "session"], 10000);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain(
      'Invalid --cookie value: session. Expected "name=value".'
    );
  }, 15000);

  it("prints v1 JSON summary to stdout for --format json", async () => {
    const run = await runCli(buildAuditArgs(["--format", "json"]), 60000);
    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout) as Record<string, unknown>;
    expect(parsed).toHaveProperty("schemaVersion");
    expect(parsed).toHaveProperty("$schema");
    expect(parsed).toHaveProperty("overallStatus");
    expect(parsed).toHaveProperty("artifacts");
  }, 90000);

  it("prints markdown summary to stdout for --format md", async () => {
    const run = await runCli(buildAuditArgs(["--format", "md"]), 60000);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("# Web Quality Gatekeeper Report");
    expect(run.stdout).toContain("| Step | Status | Badge |");
    expect(() => JSON.parse(run.stdout)).toThrow();
  }, 90000);

  it("prints version with --version flag", () => {
    const output = execFileSync("node", [CLI, "--version"], {
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
});
