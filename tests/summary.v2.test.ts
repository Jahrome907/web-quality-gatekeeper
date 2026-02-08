import { describe, expect, it } from "vitest";
import { buildSummaryV2, SCHEMA_VERSION_V2, SUMMARY_SCHEMA_URI_V2 } from "../src/report/summary.js";
import type { RuntimeSignalSummary } from "../src/runner/playwright.js";

const runtimeSignals: RuntimeSignalSummary = {
  console: {
    total: 5,
    errorCount: 1,
    warningCount: 2,
    dropped: 0,
    messages: [{ type: "warning", text: "slow script", location: "https://example.com/app.js:1:1" }]
  },
  jsErrors: {
    total: 1,
    dropped: 0,
    errors: [{ message: "ReferenceError", stack: "stack" }]
  },
  network: {
    totalRequests: 12,
    failedRequests: 2,
    transferSizeBytes: 2048,
    resourceTypeBreakdown: { document: 1, script: 11 }
  }
};

const baseParams = {
  url: "https://example.com",
  startedAt: "2026-02-08T00:00:00.000Z",
  durationMs: 5000,
  toolVersion: "0.3.0",
  screenshots: [{ name: "home", path: "screenshots/home.png", url: "https://example.com", fullPage: true }],
  artifacts: {
    summary: "summary.json",
    summaryV2: "summary.v2.json",
    report: "report.html",
    axe: "axe.json",
    lighthouse: "lighthouse.json",
    screenshotsDir: "screenshots",
    diffsDir: "diffs",
    baselineDir: "../baselines"
  },
  runtimeSignals
};

describe("buildSummaryV2", () => {
  it("includes runtime signals and v2 schema metadata", () => {
    const summary = buildSummaryV2({
      ...baseParams,
      a11y: null,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    expect(summary.$schema).toBe(SUMMARY_SCHEMA_URI_V2);
    expect(summary.schemaVersion).toBe(SCHEMA_VERSION_V2);
    expect(summary.runtimeSignals).toEqual(runtimeSignals);
    expect(summary.artifacts.summaryV2).toBe("summary.v2.json");
    expect(summary.steps.a11y).toBe("skipped");
    expect(summary.overallStatus).toBe("pass");
  });

  it("fails overall when enabled checks fail", () => {
    const summary = buildSummaryV2({
      ...baseParams,
      a11y: {
        violations: 1,
        countsByImpact: { critical: 1, serious: 0, moderate: 0, minor: 0 },
        reportPath: "axe.json",
        details: [],
        metadata: { totalViolations: 1, keptViolations: 1, droppedViolations: 0, droppedNodes: 0 }
      },
      performance: {
        metrics: { performanceScore: 0.5, lcpMs: 4000, cls: 0.3, tbtMs: 500 },
        budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
        budgetResults: { performance: false, lcp: false, cls: false, tbt: false },
        reportPath: "lighthouse.json"
      },
      visual: {
        results: [],
        threshold: 0.01,
        failed: true,
        maxMismatchRatio: 0.1
      },
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    expect(summary.overallStatus).toBe("fail");
    expect(summary.steps.a11y).toBe("fail");
    expect(summary.steps.perf).toBe("fail");
    expect(summary.steps.visual).toBe("fail");
  });

  it("passes when failures are configured not to fail build", () => {
    const summary = buildSummaryV2({
      ...baseParams,
      a11y: {
        violations: 3,
        countsByImpact: { critical: 1, serious: 1, moderate: 1, minor: 0 },
        reportPath: "axe.json",
        details: [],
        metadata: { totalViolations: 3, keptViolations: 3, droppedViolations: 0, droppedNodes: 0 }
      },
      performance: null,
      visual: null,
      options: { failOnA11y: false, failOnPerf: true, failOnVisual: true }
    });

    expect(summary.overallStatus).toBe("pass");
    expect(summary.steps.a11y).toBe("pass");
  });
});
