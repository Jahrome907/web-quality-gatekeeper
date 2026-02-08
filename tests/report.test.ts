import { describe, expect, it } from "vitest";
import { buildHtmlReport } from "../src/report/html.js";
import type { Summary } from "../src/report/summary.js";

const summary: Summary = {
  $schema:
    "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
  schemaVersion: "1.1.0",
  toolVersion: "0.3.0",
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
    reportPath: "axe.json",
    details: [],
    metadata: {
      totalViolations: 0,
      keptViolations: 0,
      droppedViolations: 0,
      droppedNodes: 0
    }
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
    reportPath: "lighthouse.json",
    categoryScores: {
      performance: 0.92,
      accessibility: 0.94,
      bestPractices: 0.88,
      seo: 0.91
    },
    extendedMetrics: {
      fcpMs: 1200,
      speedIndexMs: 2100,
      ttiMs: 2400,
      ttfbMs: 420
    },
    opportunities: [
      {
        id: "render-blocking-resources",
        title: "Eliminate render-blocking resources",
        score: 0.42,
        displayValue: "Potential savings of 400 ms",
        estimatedSavingsMs: 400,
        estimatedSavingsBytes: 24576
      },
      {
        id: "unused-css-rules",
        title: "Reduce unused CSS",
        score: 0.51,
        displayValue: "Potential savings of 14 KiB",
        estimatedSavingsMs: 120,
        estimatedSavingsBytes: 14336
      }
    ]
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
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Category Scores");
    expect(html).toContain("Core Web Vitals");
    expect(html).toContain("Lighthouse Opportunities");
    expect(html).toContain("Console and JavaScript Errors");
    expect(html).toContain("Resource Breakdown");
    expect(html).toContain("Baseline, Current, and Diff Screenshots");
  });

  it("renders diagnostics and resource breakdown from canonical runtimeSignals", () => {
    const enrichedSummary = {
      ...summary,
      runtimeSignals: {
        console: {
          total: 9,
          errorCount: 7,
          warningCount: 1,
          dropped: 2,
          messages: [
            {
              type: "error",
              text: "Failed to load analytics script",
              location: "https://example.com/app.js:12:8"
            }
          ]
        },
        jsErrors: {
          total: 2,
          dropped: 0,
          errors: [
            {
              message: "TypeError: cannot read property",
              stack: "TypeError at app.js:88:5"
            }
          ]
        },
        network: {
          totalRequests: 21,
          failedRequests: 1,
          transferSizeBytes: 300000,
          resourceTypeBreakdown: {
            script: 9,
            stylesheet: 4,
            image: 6,
            font: 2
          }
        }
      }
    } as Summary;

    const html = buildHtmlReport(enrichedSummary);
    expect(html).toContain("Failed to load analytics script");
    expect(html).toContain("Showing 1 of 7 entries.");
    expect(html).toContain("Total transfer size");
    expect(html).toContain("JS");
    expect(html).toContain("Image");
  });

  it("keeps compatibility fallback for legacy performance diagnostics", () => {
    const fallbackSummary = {
      ...summary,
      performance: {
        ...summary.performance!,
        diagnostics: {
          consoleErrors: {
            total: 1,
            entries: [
              {
                message: "Legacy console error",
                source: "console.error",
                url: "https://example.com/legacy.js",
                line: 4,
                column: 2
              }
            ]
          },
          jsErrors: {
            total: 1,
            entries: [{ message: "Legacy TypeError" }]
          },
          resourceBreakdown: {
            totalBytes: 3000,
            totalRequests: 3,
            items: [
              { type: "script", transferSize: 1500, requestCount: 1 },
              { type: "image", transferSize: 1000, requestCount: 1 },
              { type: "font", transferSize: 500, requestCount: 1 }
            ]
          }
        }
      }
    } as Summary;

    const html = buildHtmlReport(fallbackSummary);
    expect(html).toContain("Legacy console error");
    expect(html).toContain("Legacy TypeError");
    expect(html).toContain("Total transfer size: 2.9 KB");
  });

  it("defensively renders runtime signals, resources, and visual asset paths", () => {
    const defensiveSummary = {
      ...summary,
      visual: {
        ...summary.visual!,
        results: summary.visual!.results.map((result) => ({
          ...result,
          baselinePath: "",
          currentPath: "   ",
          diffPath: null
        }))
      },
      performance: {
        ...summary.performance!,
        diagnostics: {
          consoleErrors: {
            count: -7,
            entries: [{ ignored: true }]
          },
          jsErrors: {
            count: 2,
            entries: [{ message: "ReferenceError: missingVar is not defined" }]
          },
          resourceBreakdown: {
            totalBytes: -10,
            totalRequests: -3,
            items: [{ resourceType: "script", transferSize: -5000, requestCount: -1 }]
          }
        }
      }
    } as Summary;

    const html = buildHtmlReport(defensiveSummary);
    expect(html).toContain("Baseline unavailable");
    expect(html).toContain("Current unavailable");
    expect(html).toContain("Diff unavailable");
    expect(html).toContain("No console error details available.");
    expect(html).toContain("Total transfer size: 0 B");
    expect(html).toContain("Total requests: 0");
  });

  it("renders stable high-signal layout fragments", () => {
    const html = buildHtmlReport(summary);

    const headerMatch = html.match(/<div class="header">[\s\S]*?<\/button>\s*<\/div>/);
    expect(headerMatch?.[0]).toContain("Web Quality Gatekeeper");
    expect(headerMatch?.[0]).toContain("https://example.com");

    const categorySection = html.match(/<h2>Category Scores<\/h2>[\s\S]*?<\/section>/);
    expect(categorySection?.[0]).toContain("gauge-card");
    expect(categorySection?.[0]).toContain("Performance score");

    const visualsSection = html.match(/<h2>Baseline, Current, and Diff Screenshots<\/h2>[\s\S]*?<\/section>/);
    expect(visualsSection?.[0]).toContain("figcaption>Baseline");
    expect(visualsSection?.[0]).toContain("figcaption>Current");
    expect(visualsSection?.[0]).toContain("figcaption>Diff");
  });
});
