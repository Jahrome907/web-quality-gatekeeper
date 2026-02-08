import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const mockLoadConfig = vi.fn();
const mockOpenPage = vi.fn();
const mockCaptureScreenshots = vi.fn();
const mockRunAxeScan = vi.fn();
const mockRunLighthouseAudit = vi.fn();
const mockRunVisualDiff = vi.fn();

vi.mock("../src/config/loadConfig.js", () => ({
  loadConfig: mockLoadConfig
}));
vi.mock("../src/runner/playwright.js", () => ({
  openPage: mockOpenPage,
  captureScreenshots: mockCaptureScreenshots
}));
vi.mock("../src/runner/axe.js", () => ({
  runAxeScan: mockRunAxeScan
}));
vi.mock("../src/runner/lighthouse.js", () => ({
  runLighthouseAudit: mockRunLighthouseAudit
}));
vi.mock("../src/runner/visualDiff.js", () => ({
  runVisualDiff: mockRunVisualDiff
}));
vi.mock("../src/report/html.js", () => ({
  buildHtmlReport: () => "<html>phase4</html>"
}));

function createRuntimeSignals() {
  return {
    console: {
      total: 0,
      errorCount: 0,
      warningCount: 0,
      dropped: 0,
      messages: []
    },
    jsErrors: {
      total: 0,
      dropped: 0,
      errors: []
    },
    network: {
      totalRequests: 0,
      failedRequests: 0,
      transferSizeBytes: 0,
      resourceTypeBreakdown: {}
    }
  };
}

function createBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    timeouts: {
      navigationMs: 10000,
      actionMs: 5000,
      waitAfterLoadMs: 0
    },
    playwright: {
      viewport: {
        width: 1280,
        height: 720
      },
      userAgent: "wqg-test/0.0.0",
      locale: "en-US",
      colorScheme: "light"
    },
    screenshots: [{ name: "home", path: "/", fullPage: true }],
    lighthouse: {
      budgets: {
        performance: 0.8,
        lcpMs: 2500,
        cls: 0.1,
        tbtMs: 200
      },
      formFactor: "desktop"
    },
    visual: {
      threshold: 0.01
    },
    toggles: {
      a11y: false,
      perf: false,
      visual: false
    },
    ...overrides
  };
}

function createA11ySummary(outDir: string, violations: number) {
  return {
    violations,
    countsByImpact: {
      critical: violations,
      serious: 0,
      moderate: 0,
      minor: 0
    },
    reportPath: path.join(outDir, "axe.json"),
    details: [],
    metadata: {
      totalViolations: violations,
      keptViolations: violations,
      droppedViolations: 0,
      droppedNodes: 0
    }
  };
}

function createSummaryV2Validator() {
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), "schemas", "summary.v2.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

describe("phase4 orchestration and trend lifecycle", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockOpenPage.mockResolvedValue({
      browser: { close: vi.fn() },
      page: {},
      runtimeSignals: {
        snapshot: () => createRuntimeSignals()
      }
    });

    mockCaptureScreenshots.mockImplementation(async (_page, baseUrl: string, _config, screenshotsDir: string) => {
      return [
        {
          name: "home",
          path: path.join(screenshotsDir, "home.png"),
          url: `${baseUrl}`,
          fullPage: true
        }
      ];
    });

    mockRunAxeScan.mockImplementation(async (_page, outDir: string) => createA11ySummary(outDir, 0));
    mockRunLighthouseAudit.mockResolvedValue(null);
    mockRunVisualDiff.mockResolvedValue(null);
  });

  afterEach(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function createRunDirs() {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-phase4-"));
    tempDirs.push(root);
    return {
      outDir: path.join(root, "artifacts"),
      baselineDir: path.join(root, "baselines"),
      configPath: path.join(root, "config.json")
    };
  }

  it("keeps config.urls order, uses deterministic sanitized page paths, and preserves per-page status", async () => {
    const { outDir, baselineDir } = await createRunDirs();

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
    const { outDir, baselineDir } = await createRunDirs();

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
    const { outDir, baselineDir } = await createRunDirs();

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
    const { outDir, baselineDir } = await createRunDirs();

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

  it("computes trend status and deltas for no_previous and ready states", async () => {
    const { outDir, baselineDir } = await createRunDirs();

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        },
        toggles: { a11y: true, perf: false, visual: false }
      })
    );

    let violations = 0;
    mockRunAxeScan.mockImplementation(async (_page, targetOutDir: string) => {
      return createA11ySummary(targetOutDir, violations);
    });

    const { runAudit } = await import("../src/index.js");

    const first = await runAudit("https://example.com", {
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

    expect(first.summaryV2.trend.status).toBe("no_previous");
    expect(first.summaryV2.trend.metrics).toBeNull();
    expect(typeof first.summaryV2.trend.message).toBe("string");

    violations = 2;

    const second = await runAudit("https://example.com", {
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

    expect(second.summaryV2.trend.status).toBe("ready");
    expect(second.summaryV2.trend.metrics).not.toBeNull();
    expect(second.summaryV2.trend.metrics?.failedPages.delta).toBe(1);
    expect(second.summaryV2.trend.metrics?.a11yViolations.delta).toBe(2);
    expect(second.summaryV2.trend.pages[0]?.a11yViolations.delta).toBe(2);
    expect(second.summaryV2.trend.pages[0]?.statusChanged).toBe(true);
  });

  it("handles incompatible previous snapshots safely", async () => {
    const { outDir, baselineDir } = await createRunDirs();
    const historyDir = path.join(outDir, ".history");

    await rm(historyDir, { recursive: true, force: true });
    await mkdir(historyDir, { recursive: true });
    await writeFile(
      path.join(historyDir, "2026-02-08T00-00-00-000Z.summary.v2.json"),
      JSON.stringify({ schemaVersion: "1.1.0", pages: [] }),
      "utf8"
    );

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

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

    expect(result.summaryV2.trend.status).toBe("incompatible_previous");
    expect(result.summaryV2.trend.metrics).toBeNull();
    expect(result.summaryV2.trend.message).toContain("No compatible previous snapshot");
  });

  it("handles corrupt previous snapshots safely", async () => {
    const { outDir, baselineDir } = await createRunDirs();
    const historyDir = path.join(outDir, ".history");

    await rm(historyDir, { recursive: true, force: true });
    await mkdir(historyDir, { recursive: true });
    await writeFile(path.join(historyDir, "2026-02-08T00-00-00-000Z.summary.v2.json"), "{not-json", "utf8");

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

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

    expect(result.summaryV2.trend.status).toBe("corrupt_previous");
    expect(result.summaryV2.trend.metrics).toBeNull();
    expect(result.summaryV2.trend.message).toContain("snapshots were corrupt");
  });

  it("keeps page ordering and artifact paths stable across repeated multi-page runs", async () => {
    const { outDir, baselineDir } = await createRunDirs();

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        urls: [
          { name: "Landing Page", url: "https://example.com/" },
          { name: "Checkout/Flow", url: "https://example.com/checkout" }
        ]
      })
    );

    const { runAudit } = await import("../src/index.js");
    const first = await runAudit(undefined, {
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

    const second = await runAudit(undefined, {
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

    expect(first.summaryV2.pages.map((page) => page.name)).toEqual(
      second.summaryV2.pages.map((page) => page.name)
    );
    expect(first.summaryV2.pages.map((page) => page.url)).toEqual(
      second.summaryV2.pages.map((page) => page.url)
    );
    expect(first.summaryV2.pages.map((page) => page.artifacts.summary)).toEqual(
      second.summaryV2.pages.map((page) => page.artifacts.summary)
    );
    expect(first.summaryV2.pages.map((page) => page.artifacts.summaryV2)).toEqual(
      second.summaryV2.pages.map((page) => page.artifacts.summaryV2)
    );
    expect(first.summaryV2.pages.map((page) => page.artifacts.report)).toEqual(
      second.summaryV2.pages.map((page) => page.artifacts.report)
    );
  });

  it("prunes trend snapshots to maxSnapshots without off-by-one errors", async () => {
    const { outDir, baselineDir } = await createRunDirs();

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 2
        }
      })
    );

    const { runAudit } = await import("../src/index.js");

    for (let i = 0; i < 3; i += 1) {
      await runAudit("https://example.com", {
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
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const historyDir = path.join(outDir, ".history");
    const snapshots = (await readdir(historyDir)).filter((entry) => entry.endsWith(".summary.v2.json"));

    expect(snapshots.length).toBe(2);
  });

  it("emits canonical runtime trend status tokens", async () => {
    const validateV2 = createSummaryV2Validator();
    const observed = new Set<string>();
    const { runAudit } = await import("../src/index.js");

    const disabledRun = await createRunDirs();
    mockLoadConfig.mockResolvedValueOnce(createBaseConfig());
    const disabled = await runAudit("https://example.com", {
      config: "ignored.json",
      out: disabledRun.outDir,
      baselineDir: disabledRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(disabled.summaryV2.trend.status);
    expect(validateV2(disabled.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const trendRun = await createRunDirs();
    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const noPrevious = await runAudit("https://example.com", {
      config: "ignored.json",
      out: trendRun.outDir,
      baselineDir: trendRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(noPrevious.summaryV2.trend.status);
    expect(validateV2(noPrevious.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const ready = await runAudit("https://example.com", {
      config: "ignored.json",
      out: trendRun.outDir,
      baselineDir: trendRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(ready.summaryV2.trend.status);
    expect(validateV2(ready.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const incompatibleRun = await createRunDirs();
    await mkdir(path.join(incompatibleRun.outDir, ".history"), { recursive: true });
    await writeFile(
      path.join(incompatibleRun.outDir, ".history", "2026-02-08T00-00-00-000Z.summary.v2.json"),
      JSON.stringify({ schemaVersion: "1.1.0", pages: [] }),
      "utf8"
    );

    mockLoadConfig.mockResolvedValueOnce(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const incompatible = await runAudit("https://example.com", {
      config: "ignored.json",
      out: incompatibleRun.outDir,
      baselineDir: incompatibleRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(incompatible.summaryV2.trend.status);
    expect(validateV2(incompatible.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const corruptRun = await createRunDirs();
    await mkdir(path.join(corruptRun.outDir, ".history"), { recursive: true });
    await writeFile(
      path.join(corruptRun.outDir, ".history", "2026-02-08T00-00-00-000Z.summary.v2.json"),
      "{not-json",
      "utf8"
    );

    mockLoadConfig.mockResolvedValueOnce(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const corrupt = await runAudit("https://example.com", {
      config: "ignored.json",
      out: corruptRun.outDir,
      baselineDir: corruptRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(corrupt.summaryV2.trend.status);
    expect(validateV2(corrupt.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    expect(Array.from(observed).sort()).toEqual(
      ["corrupt_previous", "disabled", "incompatible_previous", "no_previous", "ready"].sort()
    );
    expect(observed.has("no_previous_snapshot")).toBe(false);
    expect(observed.has("previous_snapshot_invalid")).toBe(false);
  });
});
