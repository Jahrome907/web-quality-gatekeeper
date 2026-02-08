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
    // Run the CLI against the local fixture server.
    // Uses async execFile so the event loop can serve fixture requests.
    await execFileAsync("node", [
      CLI,
      "audit",
      baseUrl,
      "--out", outDir,
      "--no-fail-on-a11y",
      "--no-fail-on-perf",
      "--no-fail-on-visual",
      "--config", TEST_CONFIG,
      "--baseline-dir", path.join(outDir, "baselines"),
    ], {
      cwd: ROOT,
      timeout: 60000,
      env: { ...process.env, NO_COLOR: "1" },
    });

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

  it("returns exit code 2 for invalid URL", () => {
    try {
      execFileSync("node", [CLI, "audit", "not-a-url"], {
        cwd: ROOT,
        timeout: 10000,
        env: { ...process.env, NO_COLOR: "1" },
      });
      expect.fail("should have thrown");
    } catch (error) {
      const err = error as { status: number; stderr: Buffer };
      expect(err.status).toBe(2);
      expect(err.stderr.toString()).toContain("Invalid URL");
    }
  }, 15000);

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
});
