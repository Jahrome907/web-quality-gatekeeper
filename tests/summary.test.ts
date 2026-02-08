import { describe, expect, it } from "vitest";
import { buildSummary, SCHEMA_VERSION, SUMMARY_SCHEMA_URI } from "../src/report/summary.js";
import type { AxeSummary } from "../src/runner/axe.js";
import type { LighthouseSummary } from "../src/runner/lighthouse.js";
import type { VisualDiffSummary } from "../src/runner/visualDiff.js";

const baseParams = {
  url: "https://example.com",
  startedAt: "2025-01-01T00:00:00.000Z",
  durationMs: 5000,
  toolVersion: "3.0.0",
  screenshots: [{ name: "home", path: "screenshots/home.png", url: "https://example.com", fullPage: true }],
  artifacts: {
    summary: "summary.json",
    report: "report.html",
    axe: null,
    lighthouse: null,
    screenshotsDir: "screenshots",
    diffsDir: "diffs",
    baselineDir: "../baselines"
  }
};

const passingA11y: AxeSummary = {
  violations: 0,
  countsByImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 },
  reportPath: "axe.json"
};

const failingA11y: AxeSummary = {
  violations: 3,
  countsByImpact: { critical: 1, serious: 1, moderate: 1, minor: 0 },
  reportPath: "axe.json"
};

const passingPerf: LighthouseSummary = {
  metrics: { performanceScore: 0.95, lcpMs: 1500, cls: 0.02, tbtMs: 100 },
  budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
  budgetResults: { performance: true, lcp: true, cls: true, tbt: true },
  reportPath: "lighthouse.json"
};

const failingPerf: LighthouseSummary = {
  metrics: { performanceScore: 0.5, lcpMs: 5000, cls: 0.3, tbtMs: 500 },
  budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
  budgetResults: { performance: false, lcp: false, cls: false, tbt: false },
  reportPath: "lighthouse.json"
};

const passingVisual: VisualDiffSummary = {
  results: [],
  threshold: 0.01,
  failed: false,
  maxMismatchRatio: 0
};

const failingVisual: VisualDiffSummary = {
  results: [],
  threshold: 0.01,
  failed: true,
  maxMismatchRatio: 0.05
};

describe("buildSummary", () => {
  it("returns pass when all steps pass", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: passingA11y,
      performance: passingPerf,
      visual: passingVisual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("pass");
    expect(summary.steps.a11y).toBe("pass");
    expect(summary.steps.perf).toBe("pass");
    expect(summary.steps.visual).toBe("pass");
  });

  it("returns fail when a11y fails and failOnA11y is true", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: failingA11y,
      performance: passingPerf,
      visual: passingVisual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("fail");
    expect(summary.steps.a11y).toBe("fail");
  });

  it("returns pass when a11y fails but failOnA11y is false", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: failingA11y,
      performance: passingPerf,
      visual: passingVisual,
      options: { failOnA11y: false, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("pass");
    expect(summary.steps.a11y).toBe("pass");
  });

  it("returns fail when perf fails", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: passingA11y,
      performance: failingPerf,
      visual: passingVisual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("fail");
    expect(summary.steps.perf).toBe("fail");
  });

  it("returns fail when visual fails", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: passingA11y,
      performance: passingPerf,
      visual: failingVisual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("fail");
    expect(summary.steps.visual).toBe("fail");
  });

  it("marks skipped steps when null", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: null,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("pass");
    expect(summary.steps.a11y).toBe("skipped");
    expect(summary.steps.perf).toBe("skipped");
    expect(summary.steps.visual).toBe("skipped");
  });

  it("passes with zero violations even when failOnA11y is true", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: passingA11y,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("pass");
    expect(summary.steps.a11y).toBe("pass");
  });

  it("fails when all steps fail", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: failingA11y,
      performance: failingPerf,
      visual: failingVisual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.overallStatus).toBe("fail");
    expect(summary.steps.a11y).toBe("fail");
    expect(summary.steps.perf).toBe("fail");
    expect(summary.steps.visual).toBe("fail");
  });

  it("preserves url and timing fields", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: null,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.url).toBe("https://example.com");
    expect(summary.startedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(summary.durationMs).toBe(5000);
  });

  it("includes schemaVersion and toolVersion", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: null,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });
    expect(summary.$schema).toBe(SUMMARY_SCHEMA_URI);
    expect(summary.schemaVersion).toBe(SCHEMA_VERSION);
    expect(summary.toolVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
