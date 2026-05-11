import { describe, expect, it } from "vitest";
import { buildHtmlReport } from "../src/report/html.js";
import type { Summary, SummaryV2 } from "../src/report/summary.js";
import type { AggregateHtmlReport } from "../src/report/viewModel.js";

const summary: Summary = {
  $schema:
    "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
  schemaVersion: "1.1.0",
  toolVersion: "3.0.0",
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

function createSummaryV2(overrides?: Partial<SummaryV2>): SummaryV2 {
  return {
    ...summary,
    $schema:
      "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
    schemaVersion: "2.2.0",
    artifacts: {
      ...summary.artifacts,
      summaryV2: "summary.v2.json"
    },
    runtimeSignals: {
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
        totalRequests: 4,
        failedRequests: 0,
        transferSizeBytes: 2048,
        resourceTypeBreakdown: {
          document: 1,
          script: 2,
          stylesheet: 1
        }
      }
    },
    insights: null,
    ...overrides
  };
}

describe("buildHtmlReport", () => {
  it("renders key sections", () => {
    const html = buildHtmlReport(summary);
    expect(html).toContain("Web Quality Gatekeeper");
    expect(html).toContain("Executive Summary");
    expect(html).toContain("Category Scores");
    expect(html).toContain("Lighthouse Performance Timings");
    expect(html).toContain("Captured Playwright Screenshots");
    expect(html).toContain("Lighthouse Opportunities");
    expect(html).toContain("Console and JavaScript Errors");
    expect(html).toContain("Resource Breakdown");
    expect(html).toContain("Baseline, Current, and Diff Screenshots");
    expect(html).toContain("Report sections");
  });

  it("renders simple/detailed view controls and expandable info panels", () => {
    const html = buildHtmlReport(summary);
    expect(html).toContain('data-view-mode="simple"');
    expect(html).toContain('data-view-mode="detailed"');
    expect(html).toContain("Simple view");
    expect(html).toContain("Detailed view");
    expect(html).toContain("<summary>More info</summary>");
    expect(html).toContain('class="status-chip-row"');
    expect(html).toContain('class="scores-layout"');
  });

  it("shows 8 items by default with expandable view-all for large screenshot galleries", () => {
    const html = buildHtmlReport({
      ...summary,
      screenshots: Array.from({ length: 10 }, (_, index) => ({
        name: `shot-${index + 1}`,
        path: `screenshots/shot-${index + 1}.png`,
        url: "https://example.com",
        fullPage: true
      })),
      visual: {
        ...summary.visual!,
        results: Array.from({ length: 10 }, (_, index) => ({
          name: `view-${index + 1}`,
          currentPath: `screenshots/view-${index + 1}.png`,
          baselinePath: `../baselines/view-${index + 1}.png`,
          diffPath: `diffs/view-${index + 1}.png`,
          mismatchRatio: 0,
          status: "diffed" as const
        }))
      }
    });

    expect(html).toContain("View all 10 screenshots");
    expect(html).toContain("View all 10 visual comparisons");
    expect((html.match(/class="gallery-expander"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("renders click-to-enlarge image controls and lightbox shell", () => {
    const html = buildHtmlReport(summary);
    expect(html).toContain('class="zoom-trigger"');
    expect(html).toContain('id="image-lightbox"');
    expect(html).toContain('id="lightbox-image"');
    expect(html).toContain('data-preview-src="screenshots/home.png"');
    expect(html).toContain('data-preview-src="../baselines/home.png"');
    expect(html).toContain('aria-label="Image preview"');
  });

  it("renders sticky jump links and score drilldown panels", () => {
    const html = buildHtmlReport(summary);
    expect(html).toContain('class="jump-nav-link" href="#overview"');
    expect(html).toContain('class="jump-nav-link" href="#resource-breakdown"');
    expect(html).toContain('id="gauge-detail-performance"');
    expect(html).toContain('id="gauge-detail-accessibility"');
    expect(html).toContain('id="gauge-detail-best-practices"');
    expect(html).toContain('id="gauge-detail-seo"');
    expect(html).toContain('class="gauge-trigger" data-gauge-key="performance"');
    expect(html).toContain('class="gauge-trigger" data-gauge-key="seo"');
    expect(html).toContain("const setGaugePanel = (key) =>");
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
    expect(html).toContain("resource-segment-tooltip");
    expect(html).toContain("resource-legend-item");
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

  it("renders screenshot gallery fallback when no Playwright screenshots were captured", () => {
    const html = buildHtmlReport({
      ...summary,
      screenshots: []
    });

    expect(html).toContain("Captured Playwright Screenshots");
    expect(html).toContain("No Playwright screenshots were captured.");
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

    const screenshotsSection = html.match(/<h2>Captured Playwright Screenshots<\/h2>[\s\S]*?<\/section>/);
    expect(screenshotsSection?.[0]).toContain("screenshots/home.png");

    expect(html).toContain('id="accessibility-summary" class="section card" data-view-section="detailed"');
  });

  it("renders middle-axis radar scores on a separate line from the label text", () => {
    const html = buildHtmlReport(summary);
    const categorySection = html.match(/<h2>Category Scores<\/h2>[\s\S]*?<\/section>/);

    expect(categorySection?.[0]).toMatch(
      /<tspan x="[^"]+" class="radar-label-text">A11y<\/tspan>\s*<tspan x="[^"]+" dy="16" class="radar-score">94<\/tspan>/
    );
    expect(categorySection?.[0]).toMatch(
      /<tspan x="[^"]+" class="radar-label-text">Best<\/tspan>\s*<tspan x="[^"]+" dy="16" class="radar-score">88<\/tspan>/
    );
  });

  it("renders aggregate coverage honestly and includes trend insights for root reports", () => {
    const landing = createSummaryV2({
      url: "https://example.com/",
      screenshots: [
        {
          name: "landing",
          path: "pages/01-landing/screenshots/home.png",
          url: "https://example.com/",
          fullPage: true
        }
      ]
    });
    const pricing = createSummaryV2({
      url: "https://example.com/pricing",
      screenshots: [
        {
          name: "pricing",
          path: "pages/02-pricing/screenshots/home.png",
          url: "https://example.com/pricing",
          fullPage: true
        }
      ]
    });
    const aggregateReport: AggregateHtmlReport = {
      kind: "aggregate",
      steps: {
        playwright: "pass",
        a11y: "pass",
        perf: "pass",
        visual: "pass"
      },
      summary: {
        $schema:
          "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
        schemaVersion: "2.2.0",
        toolVersion: "3.1.4",
        mode: "multi",
        overallStatus: "pass",
        startedAt: "2026-04-29T00:00:00.000Z",
        durationMs: 3456,
        primaryUrl: "https://example.com/",
        schemaPointers: {
          v1: "https://example.com/summary.v1.json",
          v2: "https://example.com/summary.v2.json"
        },
        schemaVersions: {
          v1: "1.1.0",
          v2: "2.2.0"
        },
        compatibility: {
          v1SummaryPath: "summary.json",
          v1Schema: "https://example.com/summary.v1.json",
          v1SchemaVersion: "1.1.0",
          note: "compat"
        },
        artifacts: {
          summary: "summary.json",
          summaryV2: "summary.v2.json",
          report: "report.html",
          trendDashboardHtml: null,
          trendHistoryJson: null,
          actionPlanMd: "action-plan.md"
        },
        rollup: {
          pageCount: 2,
          failedPages: 0,
          a11yViolations: 0,
          performanceBudgetFailures: 0,
          visualFailures: 0
        },
        pages: [
          {
            index: 0,
            name: "landing",
            url: "https://example.com/",
            overallStatus: "pass",
            startedAt: landing.startedAt,
            durationMs: landing.durationMs,
            steps: landing.steps,
            artifacts: {
              summary: "pages/01-landing/summary.json",
              summaryV2: "pages/01-landing/summary.v2.json",
              report: "pages/01-landing/report.html"
            },
            metrics: {
              a11yViolations: 0,
              performanceScore: 0.92,
              maxMismatchRatio: 0,
              consoleErrors: 0,
              jsErrors: 0,
              failedRequests: 0
            },
            details: landing
          },
          {
            index: 1,
            name: "pricing",
            url: "https://example.com/pricing",
            overallStatus: "pass",
            startedAt: pricing.startedAt,
            durationMs: pricing.durationMs,
            steps: pricing.steps,
            artifacts: {
              summary: "pages/02-pricing/summary.json",
              summaryV2: "pages/02-pricing/summary.v2.json",
              report: "pages/02-pricing/report.html"
            },
            metrics: {
              a11yViolations: 0,
              performanceScore: 0.91,
              maxMismatchRatio: 0,
              consoleErrors: 0,
              jsErrors: 0,
              failedRequests: 0
            },
            details: pricing
          }
        ],
        trend: {
          status: "ready",
          historyDir: ".wqg-history",
          previousSnapshotPath: "prev.summary.v2.json",
          message: null,
          metrics: null,
          pages: [],
          history: null,
          insights: [
            {
              id: "trend:perf-regression",
              severity: "medium",
              title: "Performance budget failures increased",
              recommendation: "Address high-savings Lighthouse opportunities before tightening budgets."
            }
          ]
        },
        insights: {
          recommendations: [
            {
              id: "runtime:errors",
              source: "runtime",
              severity: "medium",
              title: "Fix runtime and console errors",
              why: "Runtime errors often cause broken UX and can mask quality regressions.",
              evidence: ["Console errors: 0"],
              remediation: ["Triage top repeated error signatures first."],
              verification: ["Re-run WQG and verify runtime error counts trend downward."],
              expectedImpact: "Improved runtime stability and fewer downstream test failures.",
              references: []
            }
          ]
        }
      }
    };

    const html = buildHtmlReport(aggregateReport);
    expect(html).toContain("Aggregate report for 2 pages");
    expect(html).toContain("<h2>Target Coverage</h2>");
    expect(html).toContain('data-target-coverage-table="true"');
    expect(html).toContain("landing");
    expect(html).toContain("pricing");
    expect(html).toContain("https://example.com/");
    expect(html).toContain("https://example.com/pricing");
    expect(html).toContain("Detailed metrics below represent the primary page landing");
    expect(html).toContain("Trend Insights");
    expect(html).toContain("Performance budget failures increased");

    const singleTargetReport: AggregateHtmlReport = {
      ...aggregateReport,
      summary: {
        ...aggregateReport.summary,
        mode: "single",
        rollup: {
          ...aggregateReport.summary.rollup,
          pageCount: 1
        },
        pages: [aggregateReport.summary.pages[0]!]
      }
    };
    const singleTargetHtml = buildHtmlReport(singleTargetReport);

    expect(singleTargetHtml).toContain("https://example.com/");
    expect(singleTargetHtml).toContain("Trend Insights");
    expect(singleTargetHtml).toContain("Performance budget failures increased");
    expect(singleTargetHtml).not.toContain("Aggregate report for 1 pages");
    expect(singleTargetHtml).not.toContain("<h2>Target Coverage</h2>");
  });
});
