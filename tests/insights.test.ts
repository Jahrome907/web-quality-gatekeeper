import { describe, expect, it } from "vitest";
import { buildInsights } from "../src/report/insights.js";
import type { SummaryV2 } from "../src/report/summary.js";

function createSummary(): SummaryV2 {
  return {
    $schema:
      "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
    schemaVersion: "2.2.0",
    toolVersion: "3.0.0",
    overallStatus: "fail",
    url: "https://example.com",
    startedAt: "2026-02-08T00:00:00.000Z",
    durationMs: 1000,
    steps: { playwright: "pass", a11y: "fail", perf: "pass", visual: "fail" },
    artifacts: {
      summary: "summary.json",
      summaryV2: "summary.v2.json",
      report: "report.html",
      axe: "axe.json",
      lighthouse: "lighthouse.json",
      screenshotsDir: "screenshots",
      diffsDir: "diffs",
      baselineDir: "baselines"
    },
    screenshots: [],
    a11y: {
      violations: 1,
      countsByImpact: { critical: 0, serious: 1, moderate: 0, minor: 0 },
      reportPath: "axe.json",
      details: [
        {
          id: "image-alt",
          description: "Images must have alt text",
          help: "Add alternate text",
          helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
          impact: "serious",
          wcagTags: ["wcag111"],
          tags: ["wcag111"],
          nodes: [{ target: ["img.hero"], htmlSnippet: "<img class='hero'>", failureSummary: "Missing alt" }]
        }
      ],
      metadata: { totalViolations: 1, keptViolations: 1, droppedViolations: 0, droppedNodes: 0 }
    },
    performance: {
      metrics: { performanceScore: 0.7, lcpMs: 2200, cls: 0.1, tbtMs: 200 },
      budgets: { performance: 0.8, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      budgetResults: { performance: false, lcp: true, cls: true, tbt: true },
      reportPath: "lighthouse.json",
      opportunities: [
        {
          id: "unused-javascript",
          title: "Reduce unused JavaScript",
          score: 0.2,
          displayValue: "Potential savings",
          estimatedSavingsMs: 250,
          estimatedSavingsBytes: 1024
        }
      ]
    },
    visual: {
      results: [
        {
          name: "home",
          currentPath: "screenshots/home.png",
          baselinePath: "baselines/home.png",
          diffPath: "diffs/home.png",
          mismatchRatio: 0.04,
          status: "diffed"
        }
      ],
      threshold: 0.01,
      failed: true,
      maxMismatchRatio: 0.04
    },
    runtimeSignals: {
      console: { total: 3, errorCount: 1, warningCount: 0, dropped: 0, messages: [] },
      jsErrors: { total: 0, dropped: 0, errors: [] },
      network: { totalRequests: 12, failedRequests: 1, transferSizeBytes: 1024, resourceTypeBreakdown: {} }
    },
    insights: null
  };
}

describe("buildInsights", () => {
  it("generates prioritized recommendations from summary failures", () => {
    const insights = buildInsights(createSummary());

    expect(insights.recommendations.length).toBeGreaterThan(0);
    expect(insights.recommendations.some((item) => item.source === "a11y")).toBe(true);
    expect(insights.recommendations.some((item) => item.source === "perf")).toBe(true);
    expect(insights.recommendations.some((item) => item.source === "visual")).toBe(true);
  });
});
