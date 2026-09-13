import { describe, expect, it } from "vitest";
import { aggregateInsights, buildInsights } from "../src/report/insights.js";
import type { SummaryV2 } from "../src/report/summary.js";

function createSummary(): SummaryV2 {
  return {
    $schema:
      "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
    schemaVersion: "2.3.0",
    toolVersion: "3.0.0",
    overallStatus: "fail",
    url: "https://example.com",
    startedAt: "2026-02-08T00:00:00.000Z",
    durationMs: 1000,
    steps: { playwright: "pass", a11y: "fail", perf: "fail", visual: "fail" },
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
          nodes: [
            {
              target: ["img.hero"],
              htmlSnippet: "<img class='hero'>",
              failureSummary: "Missing alt"
            }
          ]
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
      network: {
        totalRequests: 12,
        failedRequests: 1,
        transferSizeBytes: 1024,
        resourceTypeBreakdown: {}
      }
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

  it("recommends runtime triage for failed network requests without console or JS errors", () => {
    const summary = createSummary();
    summary.runtimeSignals.console.errorCount = 0;
    summary.runtimeSignals.jsErrors.total = 0;
    summary.runtimeSignals.network.failedRequests = 2;

    const insights = buildInsights(summary);

    expect(insights.recommendations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime:errors",
          source: "runtime",
          evidence: expect.arrayContaining(["Failed network requests: 2"])
        })
      ])
    );
  });

  it("describes Lighthouse opportunities as reported opportunities without claiming a bottleneck", () => {
    const insights = buildInsights(createSummary());
    const performanceInsight = insights.recommendations.find(
      (item) => item.id === "perf:unused-javascript"
    );

    expect(performanceInsight).toMatchObject({
      severity: "low",
      why: "Optional performance improvement. This opportunity does not itself fail a configured budget.",
      expectedImpact: "Lighthouse estimated savings: 250ms, 1024 bytes."
    });
  });

  it("keeps zero-time CSS savings optional when all performance budgets pass", () => {
    const summary = createSummary();
    summary.steps.perf = "pass";
    summary.performance!.metrics.performanceScore = 0.95;
    summary.performance!.budgetResults.performance = true;
    summary.performance!.opportunities = [
      {
        id: "unused-css-rules",
        title: "Reduce unused CSS",
        score: 0,
        displayValue: "12 KiB",
        estimatedSavingsMs: 0,
        estimatedSavingsBytes: 12129
      }
    ];
    const before = structuredClone(summary);
    const result = buildInsights(summary);
    const css = result.recommendations.find((item) => item.id === "perf:unused-css-rules");
    expect(css).toMatchObject({
      severity: "low",
      expectedImpact: "Lighthouse estimated savings: 0ms, 12129 bytes."
    });
    expect(result.recommendations.some((item) => item.id === "perf:budgets")).toBe(false);
    expect(result.recommendations.indexOf(css!)).toBeGreaterThan(
      result.recommendations.findIndex((item) => item.id === "a11y:image-alt")
    );
    expect(summary).toEqual(before);
  });

  it("shows failed metrics and limits even when there are no Lighthouse opportunities", () => {
    const summary = createSummary();
    summary.performance!.opportunities = [];
    summary.performance!.metrics.lcpMs = 3000;
    summary.performance!.budgetResults.lcp = false;
    const budget = buildInsights(summary).recommendations.find(
      (item) => item.id === "perf:budgets"
    );
    expect(budget).toMatchObject({
      severity: "high",
      evidence: [
        "Page: https://example.com",
        "Performance score: 0.7; minimum: 0.8",
        "LCP: 3000 ms; maximum: 2500 ms"
      ]
    });
  });

  it("does not describe ignored performance budgets as gate failures", () => {
    const summary = createSummary();
    summary.steps.perf = "pass";
    expect(buildInsights(summary).recommendations.some((item) => item.id === "perf:budgets")).toBe(
      false
    );
  });

  it("retains each failing page's budget evidence in the combined report", () => {
    const first = createSummary();
    first.url = "https://example.com/home";
    const second = createSummary();
    second.url = "https://example.com/contact";
    second.performance!.budgetResults = { performance: true, lcp: true, cls: false, tbt: false };
    second.performance!.metrics.cls = 0.3;
    second.performance!.metrics.tbtMs = 500;
    first.insights = buildInsights(first);
    second.insights = buildInsights(second);
    const before = structuredClone([first, second]);
    const budgets = aggregateInsights([first, second])!.recommendations.filter(
      (item) => item.id === "perf:budgets"
    );
    expect(budgets).toHaveLength(1);
    expect(budgets[0]!.evidence).toEqual([
      "Page: https://example.com/home",
      "Performance score: 0.7; minimum: 0.8",
      "Page: https://example.com/contact",
      "CLS: 0.3; maximum: 0.1",
      "TBT: 500 ms; maximum: 200 ms"
    ]);
    expect([first, second]).toEqual(before);
  });

  it("keeps failed gates ahead of optional work when recommendations are limited", () => {
    const summary = createSummary();
    summary.steps.perf = "pass";
    summary.steps.visual = "pass";
    summary.a11y!.details![0]!.impact = "minor";
    summary.runtimeSignals.console.errorCount = 8;
    expect(buildInsights(summary, 1).recommendations[0]!.id).toBe("a11y:image-alt");
  });

  it("preserves measured savings order and the strongest duplicate in combined reports", () => {
    const first = createSummary();
    first.performance!.opportunities = [
      {
        id: "a-css",
        title: "CSS",
        score: 0,
        displayValue: "",
        estimatedSavingsMs: 0,
        estimatedSavingsBytes: 12129
      },
      {
        id: "z-script",
        title: "Script",
        score: 0.8,
        displayValue: "",
        estimatedSavingsMs: 80,
        estimatedSavingsBytes: 128853
      },
      {
        id: "b-bytes",
        title: "Bytes",
        score: 0,
        displayValue: "",
        estimatedSavingsMs: null,
        estimatedSavingsBytes: 22000
      },
      {
        id: "c-unknown",
        title: "Unknown",
        score: 0,
        displayValue: "",
        estimatedSavingsMs: null,
        estimatedSavingsBytes: null
      }
    ];
    const second = structuredClone(first);
    second.steps.a11y = "pass";
    second.steps.perf = "pass";
    second.steps.visual = "pass";
    second.performance!.opportunities![1]!.estimatedSavingsMs = 10;
    first.insights = buildInsights(first);
    second.insights = buildInsights(second);
    for (const pages of [[first], [first, second], [second, first]]) {
      const result = aggregateInsights(pages)!;
      expect(
        result.recommendations.filter((item) => item.source === "perf").map((item) => item.id)
      ).toEqual(["perf:budgets", "perf:z-script", "perf:b-bytes", "perf:a-css", "perf:c-unknown"]);
      expect(
        result.recommendations.find((item) => item.id === "perf:z-script")!.expectedImpact
      ).toContain("80ms");
    }
  });
});
