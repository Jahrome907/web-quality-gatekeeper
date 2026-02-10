import { describe, expect, it } from "vitest";
import { buildHtmlReport } from "../src/report/html.js";
import type { Summary } from "../src/report/summary.js";

function createSummary(overrides?: Partial<Summary>): Summary {
  return {
    $schema:
      "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
    schemaVersion: "1.1.0",
    toolVersion: "3.0.0",
    overallStatus: "pass",
    url: "https://example.com",
    startedAt: "2026-02-08T00:00:00.000Z",
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
      violations: 2,
      countsByImpact: {
        critical: 1,
        serious: 1,
        moderate: 0,
        minor: 0
      },
      reportPath: "axe.json",
      details: [
        {
          id: "color-contrast",
          description: "contrast",
          help: "help",
          helpUrl: "https://example.com/help",
          impact: "serious",
          wcagTags: ["wcag143"],
          tags: ["wcag143"],
          nodes: []
        }
      ],
      metadata: {
        totalViolations: 2,
        keptViolations: 2,
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
        accessibility: 0.98,
        bestPractices: 0.97,
        seo: 0.95
      },
      extendedMetrics: {
        fcpMs: 900,
        speedIndexMs: 1200,
        ttiMs: 1600,
        ttfbMs: 80
      },
      opportunities: [
        {
          id: "reduce-js",
          title: "Reduce unused JavaScript",
          score: 0.56,
          displayValue: "1.2 s",
          estimatedSavingsMs: 1200,
          estimatedSavingsBytes: 150000
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
          mismatchRatio: 0,
          status: "diffed"
        }
      ],
      threshold: 0.01,
      failed: false,
      maxMismatchRatio: 0
    },
    ...overrides
  };
}

describe("HTML report template", () => {
  it("renders core sections and summary values", () => {
    const html = buildHtmlReport(createSummary());

    expect(html).toContain("Web Quality Gatekeeper");
    expect(html).toContain("<h2>Executive Summary</h2>");
    expect(html).toContain("<h2>Category Scores</h2>");
    expect(html).toContain("<h2>Core Web Vitals</h2>");
    expect(html).toContain("<h2>Captured Playwright Screenshots</h2>");
    expect(html).toContain("<h2>Accessibility</h2>");
    expect(html).toContain("<h2>Accessibility Violations</h2>");
    expect(html).toContain("<h2>Lighthouse Opportunities</h2>");
    expect(html).toContain("<h2>Baseline, Current, and Diff Screenshots</h2>");
    expect(html).toContain("<h2>Console and JavaScript Errors</h2>");
    expect(html).toContain("<h2>Resource Breakdown</h2>");
    expect(html).toContain("Total violations</th><td>2</td>");
    expect(html).toContain("Simple view");
    expect(html).toContain("Detailed view");
    expect(html).toContain("<summary>More info</summary>");
    expect(html).toContain('class="jump-nav-link" href="#overview"');
    expect(html).toContain('id="gauge-detail-performance"');
    expect(html).toContain('class="status-chip-row"');
    expect(html).toContain('class="radar-chart"');
    expect(html).toContain('class="scores-layout"');
  });

  it("renders gauge SVGs and visual image blocks", () => {
    const html = buildHtmlReport(createSummary());

    expect((html.match(/class="gauge-card card"/g) ?? []).length).toBe(4);
    expect((html.match(/<svg viewBox="0 0 120 120"/g) ?? []).length).toBe(4);
    expect(html).toContain('aria-label="Performance score 92 out of 100"');
    expect(html).toContain('src="../baselines/home.png"');
    expect(html).toContain('src="screenshots/home.png"');
    expect(html).toContain('src="diffs/home.png"');
  });

  it("escapes URL and path content in HTML", () => {
    const html = buildHtmlReport(
      createSummary({
        url: 'https://example.com/?q=<script>alert("x")</script>',
        visual: {
          results: [
            {
              name: "xss-view",
              currentPath: 'screenshots/home.png?x=<img src=x onerror=1>',
              baselinePath: "../baselines/home.png",
              diffPath: null,
              mismatchRatio: null,
              status: "diffed"
            }
          ],
          threshold: 0.01,
          failed: false,
          maxMismatchRatio: 0
        }
      })
    );

    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("screenshots/home.png?x=&lt;img src=x onerror=1&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("renders visual fallback states for missing diff assets", () => {
    const html = buildHtmlReport(
      createSummary({
        visual: {
          results: [
            {
              name: "home",
              currentPath: "screenshots/home.png",
              baselinePath: "../baselines/home.png",
              diffPath: null,
              mismatchRatio: null,
              status: "diffed"
            }
          ],
          threshold: 0.01,
          failed: false,
          maxMismatchRatio: 0
        }
      })
    );

    expect(html).toContain("Diff unavailable");
    expect(html).toContain("Mismatch ratio: <strong>n/a</strong>");
  });

  it("renders fallback text for empty or skipped sections", () => {
    const html = buildHtmlReport(
      createSummary({
        a11y: null,
        performance: null,
        visual: null,
        screenshots: [],
        steps: {
          playwright: "pass",
          a11y: "skipped",
          perf: "skipped",
          visual: "skipped"
        }
      })
    );

    expect(html).toContain(">Skipped</td>");
    expect(html).toContain("No accessibility violations captured.");
    expect(html).toContain("No opportunities captured.");
    expect(html).toContain("Visual diff step skipped or no results captured.");
    expect(html).toContain("No Playwright screenshots were captured.");
    expect(html).toContain("No console or runtime error diagnostics were provided in summary data.");
    expect(html).toContain("Resource-level transfer data was not provided in summary data.");
    expect(html).toContain('class="pill skipped"');
  });

  it("renders diagnostic and resource extraction data", () => {
    const html = buildHtmlReport(
      createSummary({
        performance: {
          ...createSummary().performance!,
          diagnostics: {
            consoleErrors: {
              total: 2,
              entries: [
                {
                  message: "Network failed",
                  source: "console.error",
                  url: "https://example.com/app.js",
                  line: 20,
                  column: 4
                }
              ]
            },
            jsErrors: {
              total: 1,
              entries: [{ message: "ReferenceError: x is not defined" }]
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
        } as Summary["performance"]
      })
    );

    expect(html).toContain("Console Errors</h3>");
    expect(html).toContain("JavaScript Runtime Errors</h3>");
    expect(html).toContain("Network failed");
    expect(html).toContain("ReferenceError: x is not defined");
    expect(html).toContain("Total transfer size: 2.9 KB");
    expect(html).toContain("<th>JS</th>");
    expect(html).toContain("<th>Image</th>");
    expect(html).toContain("<th>Font</th>");
    expect(html).toContain('class="resource-stack"');
  });

  it("captures stable report header snapshot", () => {
    const html = buildHtmlReport(createSummary());
    expect(html).toContain("Web Quality Gatekeeper");
    expect(html).toContain("https://example.com");
    expect(html).toContain("Simple view");
    expect(html).toContain("Detailed view");
    expect(html).toContain("Toggle dark mode");
    expect(html).toContain("Copy summary");
    expect(html).toContain('id="shortcuts-overlay"');
    expect(html).toContain("Keyboard Shortcuts");
  });
});
