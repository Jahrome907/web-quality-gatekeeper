import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSignalSummary } from "../src/runner/playwright.js";
import type { Summary, SummaryV2 } from "../src/report/summary.js";

const mockLoadConfig = vi.fn();
const mockOpenPage = vi.fn();
const mockCaptureScreenshots = vi.fn();
const mockRunAxeScan = vi.fn();
const mockRunLighthouseAudit = vi.fn();
const mockRunVisualDiff = vi.fn();
const mockBuildSummary = vi.fn();
const mockBuildSummaryV2 = vi.fn();
const mockBuildHtmlReport = vi.fn();
const mockEnsureDir = vi.fn();
const mockWriteJson = vi.fn();
const mockWriteText = vi.fn();
const mockValidateOutputDirectory = vi.fn();

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
vi.mock("../src/report/summary.js", () => ({
  buildSummary: mockBuildSummary,
  buildSummaryV2: mockBuildSummaryV2,
  SCHEMA_VERSION: "1.1.0",
  SCHEMA_VERSION_V2: "2.0.0",
  SUMMARY_SCHEMA_URI_V2:
    "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
  SUMMARY_SCHEMA_URI:
    "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json"
}));
vi.mock("../src/report/html.js", () => ({
  buildHtmlReport: mockBuildHtmlReport
}));
vi.mock("../src/utils/fs.js", () => ({
  ensureDir: mockEnsureDir,
  writeJson: mockWriteJson,
  writeText: mockWriteText,
  validateOutputDirectory: mockValidateOutputDirectory
}));

function createRuntimeSignals(): RuntimeSignalSummary {
  return {
    console: {
      total: 3,
      errorCount: 1,
      warningCount: 1,
      dropped: 0,
      messages: [
        {
          type: "error",
          text: "Boom",
          location: "https://example.com/app.js:1:1"
        }
      ]
    },
    jsErrors: {
      total: 1,
      dropped: 0,
      errors: [
        {
          message: "ReferenceError",
          stack: "stack"
        }
      ]
    },
    network: {
      totalRequests: 10,
      failedRequests: 1,
      transferSizeBytes: 1024,
      resourceTypeBreakdown: {
        document: 1,
        script: 9
      }
    }
  };
}

function createSummary(overallStatus: "pass" | "fail"): Summary {
  return {
    $schema:
      "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
    schemaVersion: "1.1.0",
    toolVersion: "0.3.0",
    overallStatus,
    url: "https://example.com",
    startedAt: "2026-02-08T00:00:00.000Z",
    durationMs: 1000,
    steps: {
      playwright: "pass",
      a11y: "pass",
      perf: "pass",
      visual: "pass"
    },
    artifacts: {
      summary: "summary.json",
      report: "report.html",
      axe: "axe.json",
      lighthouse: "lighthouse.json",
      screenshotsDir: "screenshots",
      diffsDir: "diffs",
      baselineDir: "../baselines"
    },
    screenshots: [],
    a11y: null,
    performance: null,
    visual: null
  };
}

function createSummaryV2(overallStatus: "pass" | "fail"): SummaryV2 {
  return {
    ...createSummary(overallStatus),
    $schema:
      "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
    schemaVersion: "2.0.0",
    artifacts: {
      ...createSummary(overallStatus).artifacts,
      summaryV2: "summary.v2.json"
    },
    runtimeSignals: createRuntimeSignals()
  };
}

function createFullConfig() {
  return {
    retries: { count: 2, delayMs: 50 },
    toggles: { a11y: true, perf: true, visual: true },
    visual: { threshold: 0.01 }
  };
}

describe("runAudit orchestration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockBuildHtmlReport.mockReturnValue("<html>report</html>");
    mockBuildSummary.mockReturnValue(createSummary("pass"));
    mockBuildSummaryV2.mockReturnValue(createSummaryV2("pass"));
  });

  it("runs all enabled checks, rewrites paths, and writes both summary versions", async () => {
    const outDir = path.resolve(process.cwd(), "artifacts");
    const baselineDir = path.resolve(process.cwd(), "baselines");
    const close = vi.fn();

    mockLoadConfig.mockResolvedValue(createFullConfig());
    mockOpenPage.mockResolvedValue({
      browser: { close },
      page: {},
      runtimeSignals: { snapshot: vi.fn().mockReturnValue(createRuntimeSignals()) }
    });
    mockCaptureScreenshots.mockResolvedValue([
      {
        name: "home",
        path: path.join(outDir, "screenshots", "home.png"),
        url: "https://example.com/",
        fullPage: true
      }
    ]);
    mockRunAxeScan.mockResolvedValue({
      violations: 1,
      countsByImpact: { critical: 1, serious: 0, moderate: 0, minor: 0 },
      reportPath: path.join(outDir, "axe.json"),
      details: [],
      metadata: {
        totalViolations: 1,
        keptViolations: 1,
        droppedViolations: 0,
        droppedNodes: 0
      }
    });
    mockRunLighthouseAudit.mockResolvedValue({
      metrics: { performanceScore: 0.95, lcpMs: 1000, cls: 0.01, tbtMs: 50 },
      budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      budgetResults: { performance: true, lcp: true, cls: true, tbt: true },
      reportPath: path.join(outDir, "lighthouse.json"),
      categoryScores: { performance: 0.95, accessibility: 0.9, bestPractices: 0.9, seo: 0.9 },
      extendedMetrics: { fcpMs: 900, speedIndexMs: 1200, ttiMs: 1500, ttfbMs: 90 },
      opportunities: []
    });
    mockRunVisualDiff.mockResolvedValue({
      results: [
        {
          name: "home",
          currentPath: path.join(outDir, "screenshots", "home.png"),
          baselinePath: path.join(baselineDir, "home.png"),
          diffPath: path.join(outDir, "diffs", "home.png"),
          mismatchRatio: 0,
          status: "diffed"
        }
      ],
      threshold: 0.01,
      failed: false,
      maxMismatchRatio: 0
    });

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit("https://example.com", {
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      format: "html",
      auth: null
    });

    expect(result.exitCode).toBe(0);
    expect(mockValidateOutputDirectory).toHaveBeenCalledTimes(2);
    expect(mockRunAxeScan).toHaveBeenCalledWith(expect.anything(), outDir, expect.anything(), expect.anything());
    expect(mockRunLighthouseAudit).toHaveBeenCalledTimes(1);
    expect(mockRunVisualDiff).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    expect(mockWriteJson).toHaveBeenCalledWith(path.join(outDir, "summary.json"), result.summary);
    expect(mockWriteJson).toHaveBeenCalledWith(path.join(outDir, "summary.v2.json"), createSummaryV2("pass"));
    expect(mockWriteText).toHaveBeenCalledWith(path.join(outDir, "report.html"), "<html>report</html>");

    const summaryArgs = mockBuildSummary.mock.calls[0]![0];
    expect(summaryArgs.screenshots[0].path).toBe("screenshots/home.png");
    expect(summaryArgs.a11y.reportPath).toBe("axe.json");
    expect(summaryArgs.performance.reportPath).toBe("lighthouse.json");
    expect(summaryArgs.visual.results[0].currentPath).toBe("screenshots/home.png");
    expect(summaryArgs.visual.results[0].baselinePath).toBe("../baselines/home.png");
    expect(summaryArgs.visual.results[0].diffPath).toBe("diffs/home.png");
    expect(summaryArgs.artifacts.baselineDir).toBe("../baselines");

    const summaryV2Args = mockBuildSummaryV2.mock.calls[0]![0];
    expect(summaryV2Args.runtimeSignals).toEqual(createRuntimeSignals());
    expect(summaryV2Args.artifacts.summaryV2).toBe("summary.v2.json");
  });

  it("skips disabled checks and passes null summaries", async () => {
    const close = vi.fn();
    mockLoadConfig.mockResolvedValue({
      toggles: { a11y: false, perf: false, visual: false },
      visual: { threshold: 0.01 }
    });
    mockOpenPage.mockResolvedValue({
      browser: { close },
      page: {},
      runtimeSignals: { snapshot: vi.fn().mockReturnValue(createRuntimeSignals()) }
    });
    mockCaptureScreenshots.mockResolvedValue([
      {
        name: "home",
        path: path.resolve(process.cwd(), "artifacts", "screenshots", "home.png"),
        url: "https://example.com/",
        fullPage: true
      }
    ]);

    const { runAudit } = await import("../src/index.js");
    await runAudit("https://example.com", {
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(mockRunAxeScan).not.toHaveBeenCalled();
    expect(mockRunLighthouseAudit).not.toHaveBeenCalled();
    expect(mockRunVisualDiff).not.toHaveBeenCalled();
    const summaryArgs = mockBuildSummary.mock.calls[0]![0];
    expect(summaryArgs.a11y).toBeNull();
    expect(summaryArgs.performance).toBeNull();
    expect(summaryArgs.visual).toBeNull();
  });

  it("returns exitCode 1 when summary overallStatus is fail", async () => {
    const close = vi.fn();
    mockLoadConfig.mockResolvedValue({
      toggles: { a11y: false, perf: false, visual: false },
      visual: { threshold: 0.01 }
    });
    mockOpenPage.mockResolvedValue({
      browser: { close },
      page: {},
      runtimeSignals: { snapshot: vi.fn().mockReturnValue(createRuntimeSignals()) }
    });
    mockCaptureScreenshots.mockResolvedValue([]);
    mockBuildSummary.mockReturnValue(createSummary("fail"));

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit("https://example.com", {
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(result.exitCode).toBe(1);
  });

  it("always closes the browser when a runner throws", async () => {
    const close = vi.fn();
    mockLoadConfig.mockResolvedValue({
      toggles: { a11y: true, perf: false, visual: false },
      visual: { threshold: 0.01 }
    });
    mockOpenPage.mockResolvedValue({
      browser: { close },
      page: {},
      runtimeSignals: { snapshot: vi.fn().mockReturnValue(createRuntimeSignals()) }
    });
    mockRunAxeScan.mockRejectedValue(new Error("axe failed"));
    mockCaptureScreenshots.mockResolvedValue([]);

    const { runAudit } = await import("../src/index.js");
    await expect(
      runAudit("https://example.com", {
        config: "configs/default.json",
        out: "artifacts",
        baselineDir: "baselines",
        setBaseline: false,
        failOnA11y: true,
        failOnPerf: true,
        failOnVisual: true,
        verbose: false,
        auth: null
      })
    ).rejects.toThrow("axe failed");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("forwards auth options to Playwright and Lighthouse runners", async () => {
    const close = vi.fn();
    mockLoadConfig.mockResolvedValue({
      toggles: { a11y: false, perf: true, visual: false },
      visual: { threshold: 0.01 }
    });
    mockOpenPage.mockResolvedValue({
      browser: { close },
      page: {},
      runtimeSignals: { snapshot: vi.fn().mockReturnValue(createRuntimeSignals()) }
    });
    mockCaptureScreenshots.mockResolvedValue([]);
    mockRunLighthouseAudit.mockResolvedValue({
      metrics: { performanceScore: 0.95, lcpMs: 1000, cls: 0.01, tbtMs: 50 },
      budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      budgetResults: { performance: true, lcp: true, cls: true, tbt: true },
      reportPath: path.resolve(process.cwd(), "artifacts", "lighthouse.json")
    });

    const auth = {
      headers: { Authorization: "Bearer token-123" },
      cookies: [{ name: "session_id", value: "abc123" }]
    };

    const { runAudit } = await import("../src/index.js");
    await runAudit("https://example.com", {
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth
    });

    expect(mockOpenPage).toHaveBeenCalledWith(
      "https://example.com/",
      expect.any(Object),
      expect.any(Object),
      auth
    );
    expect(mockRunLighthouseAudit).toHaveBeenCalledWith(
      "https://example.com/",
      expect.any(String),
      expect.any(Object),
      expect.any(Object),
      auth
    );
  });

  it("fails fast on invalid config loading without opening browser", async () => {
    mockLoadConfig.mockRejectedValue(new Error("Invalid config"));

    const { runAudit } = await import("../src/index.js");
    await expect(
      runAudit("https://example.com", {
        config: "configs/default.json",
        out: "artifacts",
        baselineDir: "baselines",
        setBaseline: false,
        failOnA11y: true,
        failOnPerf: true,
        failOnVisual: true,
        verbose: false,
        auth: null
      })
    ).rejects.toThrow("Invalid config");

    expect(mockOpenPage).not.toHaveBeenCalled();
  });
});
