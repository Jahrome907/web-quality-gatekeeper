import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLoadConfig, mockRunAxeScan, mockRunLighthouseAudit, mockCaptureScreenshots } =
  vi.hoisted(() => ({
    mockLoadConfig: vi.fn(),
    mockRunAxeScan: vi.fn(),
    mockRunLighthouseAudit: vi.fn(),
    mockCaptureScreenshots: vi.fn()
  }));

vi.mock("../src/config/loadConfig.js", () => ({
  loadConfig: mockLoadConfig
}));
vi.mock("../src/runner/playwright.js", () => ({
  runPlaywrightLifecycle: async (
    url: string,
    _config: unknown,
    _logger: unknown,
    _auth: unknown,
    _browserOptions: unknown,
    callback: (value: {
      page: object;
      runtimeSignals: { snapshot: () => object };
      resolvedUrl: string;
      resolvedHostResolverRules: null;
    }) => Promise<unknown>
  ) =>
    callback({
      page: {},
      runtimeSignals: {
        snapshot: () => ({
          console: { total: 0, errorCount: 0, warningCount: 0, dropped: 0, messages: [] },
          jsErrors: { total: 0, dropped: 0, errors: [] },
          network: {
            totalRequests: 0,
            failedRequests: 0,
            transferSizeBytes: 0,
            resourceTypeBreakdown: {}
          }
        })
      },
      resolvedUrl: url,
      resolvedHostResolverRules: null
    }),
  captureScreenshots: mockCaptureScreenshots
}));
vi.mock("../src/runner/axe.js", () => ({
  runAxeScan: mockRunAxeScan
}));
vi.mock("../src/runner/lighthouse.js", () => ({
  runLighthouseAudit: mockRunLighthouseAudit
}));
vi.mock("../src/runner/visualDiff.js", () => ({
  runVisualDiff: vi.fn()
}));

const roots: string[] = [];

function config(overrides: Record<string, unknown> = {}) {
  return {
    retries: { count: 1, delayMs: 0 },
    timeouts: { navigationMs: 1000, actionMs: 1000, waitAfterLoadMs: 0 },
    playwright: {
      viewport: { width: 1280, height: 720 },
      userAgent: "wqg-test",
      locale: "en-US",
      colorScheme: "light"
    },
    screenshots: [{ name: "home", path: "/", fullPage: true }],
    lighthouse: {
      budgets: { performance: 0.8, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      formFactor: "desktop"
    },
    visual: { threshold: 0.01 },
    toggles: { a11y: true, perf: true, visual: false },
    ...overrides
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockRunAxeScan.mockImplementation(async (_page: object, targetOutDir: string) => {
    const reportPath = path.join(targetOutDir, "axe.json");
    await writeFile(reportPath, "axe", "utf8");
    return {
      violations: 0,
      countsByImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      details: [],
      metadata: { totalViolations: 0, keptViolations: 0, droppedViolations: 0, droppedNodes: 0 },
      reportPath
    };
  });
  mockRunLighthouseAudit.mockImplementation(async (_url: string, targetOutDir: string) => {
    const reportPath = path.join(targetOutDir, "lighthouse.json");
    await writeFile(reportPath, "lighthouse", "utf8");
    return {
      metrics: { performanceScore: 0.9, lcpMs: 1000, cls: 0.01, tbtMs: 10 },
      budgets: { performance: 0.8, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      budgetResults: { performance: true, lcp: true, cls: true, tbt: true },
      reportPath,
      categoryScores: { performance: 0.9, accessibility: 0.9, bestPractices: 0.9, seo: 0.9 },
      extendedMetrics: { fcpMs: 100, speedIndexMs: 100, ttiMs: 100, ttfbMs: 100 },
      opportunities: []
    };
  });
  mockCaptureScreenshots.mockImplementation(
    async (_page: object, url: string, _config: object, screenshotDir: string) => {
      await mkdir(screenshotDir, { recursive: true });
      const screenshotPath = path.join(screenshotDir, "home.png");
      await writeFile(screenshotPath, url, "utf8");
      return [{ name: "home", path: screenshotPath, url, fullPage: true }];
    }
  );
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("output bundle orchestration", () => {
  it("publishes only current targets and enabled-check evidence with final output paths", async () => {
    const root = await mkdtemp(path.join(process.cwd(), ".tmp-output-orchestration-"));
    roots.push(root);
    const outDir = path.join(root, "artifacts");
    const baselineDir = path.join(root, "baselines");
    const { runAudit } = await import("../src/index.js");

    mockLoadConfig.mockResolvedValue(
      config({
        urls: [
          { name: "first", url: "http://127.0.0.1:4173/first" },
          { name: "second", url: "http://127.0.0.1:4173/second" }
        ]
      })
    );
    await runAudit(undefined, {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      allowInternalTargets: true
    });

    const firstSummary = JSON.parse(
      await readFile(path.join(outDir, "summary.v2.json"), "utf8")
    ) as {
      pages: Array<{
        artifacts: { summary: string };
        details: { screenshots: Array<{ path: string }> };
      }>;
    };
    expect(firstSummary.pages.map((page) => page.artifacts.summary)).toEqual([
      "pages/01-first/summary.json",
      "pages/02-second/summary.json"
    ]);
    expect(firstSummary.pages.map((page) => page.details.screenshots[0]?.path)).toEqual([
      "pages/01-first/screenshots/home.png",
      "pages/02-second/screenshots/home.png"
    ]);
    const firstPageReportPath = path.join(outDir, "pages", "01-first", "report.html");
    const firstPageReport = await readFile(firstPageReportPath, "utf8");
    const screenshotReference = firstPageReport.match(
      /<img src="([^"]+)" alt="home Playwright screenshot"/
    );
    expect(screenshotReference?.[1]).toBe("screenshots/home.png");
    expect(
      existsSync(path.resolve(path.dirname(firstPageReportPath), screenshotReference?.[1] ?? ""))
    ).toBe(true);

    mockLoadConfig.mockResolvedValue(
      config({ toggles: { a11y: false, perf: false, visual: false } })
    );
    await runAudit("http://127.0.0.1:4173/current", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      allowInternalTargets: true
    });

    const currentSummary = JSON.parse(
      await readFile(path.join(outDir, "summary.v2.json"), "utf8")
    ) as {
      mode: string;
      pages: Array<{ details: { screenshots: Array<{ path: string }> } }>;
    };
    expect(currentSummary.mode).toBe("single");
    expect(currentSummary.pages[0]?.details.screenshots[0]?.path).toBe("screenshots/home.png");
    expect(existsSync(path.join(outDir, "pages", "01-first", "summary.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "pages", "02-second", "screenshots", "home.png"))).toBe(
      false
    );
    expect(existsSync(path.join(outDir, "axe.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "lighthouse.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "screenshots", "home.png"))).toBe(true);
  });
});
