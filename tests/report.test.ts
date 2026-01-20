import { describe, expect, it } from "vitest";
import { buildHtmlReport } from "../src/report/html.js";
import type { Summary } from "../src/report/summary.js";

const summary: Summary = {
  overallStatus: "pass",
  url: "https://example.com",
  startedAt: "2024-01-01T00:00:00.000Z",
  durationMs: 1234,
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
  screenshots: [
    {
      name: "home",
      path: "screenshots/home.png",
      url: "https://example.com",
      fullPage: true
    }
  ],
  a11y: {
    violations: 0,
    countsByImpact: {
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0
    },
    reportPath: "axe.json"
  },
  performance: {
    metrics: {
      performanceScore: 0.92,
      lcpMs: 1800,
      cls: 0.04,
      tbtMs: 120
    },
    budgets: {
      performance: 0.9,
      lcpMs: 2500,
      cls: 0.1,
      tbtMs: 200
    },
    budgetResults: {
      performance: true,
      lcp: true,
      cls: true,
      tbt: true
    },
    reportPath: "lighthouse.json"
  },
  visual: {
    results: [
      {
        name: "home",
        currentPath: "screenshots/home.png",
        baselinePath: "../baselines/home.png",
        diffPath: "diffs/home.png",
        mismatchRatio: 0.0,
        status: "diffed"
      }
    ],
    threshold: 0.01,
    failed: false,
    maxMismatchRatio: 0
  }
};

describe("buildHtmlReport", () => {
  it("renders key sections", () => {
    const html = buildHtmlReport(summary);
    expect(html).toContain("Web Quality Gatekeeper");
    expect(html).toContain("Accessibility");
    expect(html).toContain("Performance");
    expect(html).toContain("Visual Diff");
  });
});
