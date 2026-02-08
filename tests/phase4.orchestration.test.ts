import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDirs,
  createA11ySummary,
  createBaseConfig,
  createRunDirs,
  createSummaryV2Validator,
  mockLoadConfig,
  mockRunAxeScan,
  resetPhase4Mocks
} from "./helpers/phase4Harness.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

describe("phase4 orchestration", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    resetPhase4Mocks();
  });

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("keeps config.urls order, uses deterministic sanitized page paths, and preserves per-page status", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    const urls = [
      { name: "Landing Page", url: "https://example.com/" },
      { name: "Checkout/Flow", url: "https://example.com/checkout" }
    ];

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        urls,
        toggles: { a11y: true, perf: false, visual: false }
      })
    );

    let call = 0;
    mockRunAxeScan.mockImplementation(async (_page, targetOutDir: string) => {
      call += 1;
      return createA11ySummary(targetOutDir, call === 1 ? 0 : 2);
    });

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit(undefined, {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(result.summary.overallStatus).toBe("fail");
    expect(result.summaryV2.mode).toBe("multi");
    expect(result.summaryV2.pages.map((page) => page.name)).toEqual(["Landing Page", "Checkout/Flow"]);
    expect(result.summaryV2.pages.map((page) => page.overallStatus)).toEqual(["pass", "fail"]);
    expect(result.summaryV2.rollup.failedPages).toBe(1);

    expect(result.summaryV2.pages[0]?.artifacts.summary).toMatch(/^pages\/01-landing-page\//);
    expect(result.summaryV2.pages[1]?.artifacts.summary).toMatch(/^pages\/02-checkout-flow\//);

    for (const page of result.summaryV2.pages) {
      expect(page.artifacts.summary.includes("..")).toBe(false);
      expect(page.artifacts.summaryV2.includes("..")).toBe(false);
      expect(page.artifacts.report.includes("..")).toBe(false);
    }
  });

  it("emits stable v2 contract fields used by multi-page and trend consumers", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        urls: [
          { name: "landing", url: "https://example.com/" },
          { name: "pricing", url: "https://example.com/pricing" }
        ],
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 5
        }
      })
    );

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit(undefined, {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(result.summaryV2).toHaveProperty("mode", "multi");
    expect(result.summaryV2).toHaveProperty("rollup");
    expect(result.summaryV2).toHaveProperty("pages");
    expect(result.summaryV2).toHaveProperty("trend");
    expect(result.summaryV2).toHaveProperty("compatibility");
    expect(result.summaryV2).toHaveProperty("schemaPointers");
    expect(result.summaryV2).toHaveProperty("schemaVersions");
    expect([
      "disabled",
      "no_previous",
      "incompatible_previous",
      "corrupt_previous",
      "ready"
    ]).toContain(result.summaryV2.trend.status);

    const validateV2 = createSummaryV2Validator();
    expect(validateV2(result.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);
  });

  it("does not report silent success when a later page run throws", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        urls: [
          { name: "first", url: "https://example.com/" },
          { name: "second", url: "https://example.com/next" }
        ],
        toggles: { a11y: true, perf: false, visual: false }
      })
    );

    let call = 0;
    mockRunAxeScan.mockImplementation(async (_page, targetOutDir: string) => {
      call += 1;
      if (call === 2) {
        throw new Error("second page failed");
      }
      return createA11ySummary(targetOutDir, 0);
    });

    const { runAudit } = await import("../src/index.js");
    await expect(
      runAudit(undefined, {
        config: "ignored.json",
        out: outDir,
        baselineDir,
        setBaseline: false,
        failOnA11y: true,
        failOnPerf: true,
        failOnVisual: true,
        verbose: false,
        auth: null
      })
    ).rejects.toThrow("second page failed");

    expect(existsSync(path.join(outDir, "summary.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "summary.v2.json"))).toBe(false);
  });

  it("keeps single-url mode v1-compatible and emits v2 summary in single mode", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(createBaseConfig());

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit("https://example.com", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(result.summary.schemaVersion).toBe("1.1.0");
    expect(result.summaryV2.mode).toBe("single");
    expect(result.summaryV2.trend.status).toBe("disabled");

    const summaryPath = path.join(outDir, "summary.json");
    const summaryRaw = await readFile(summaryPath, "utf8");
    const summary = JSON.parse(summaryRaw);

    const schema = JSON.parse(readFileSync(path.join(process.cwd(), "schemas", "summary.v1.json"), "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    expect(validate(summary), JSON.stringify(validate.errors, null, 2)).toBe(true);
    expect(existsSync(path.join(outDir, "summary.v2.json"))).toBe(true);
  });
});
