import { describe, expect, it } from "vitest";
import { formatSummaryAsMarkdown } from "../src/report/markdown.js";

function createPage(index: number, name: string, status: "pass" | "fail") {
  return {
    index,
    name,
    url: `https://example.com/${name}`,
    overallStatus: status,
    startedAt: "2026-02-08T00:00:00.000Z",
    durationMs: 1000 + index,
    steps: {
      playwright: "pass",
      a11y: status,
      perf: "pass",
      visual: "pass"
    },
    artifacts: {
      summary: `pages/0${index + 1}-${name}/summary.json`,
      summaryV2: `pages/0${index + 1}-${name}/summary.v2.json`,
      report: `pages/0${index + 1}-${name}/report.html`
    },
    metrics: {
      a11yViolations: status === "fail" ? 2 : 0,
      performanceScore: 0.9,
      maxMismatchRatio: 0.001,
      consoleErrors: 0,
      jsErrors: 0,
      failedRequests: 0
    },
    details: {
      a11y: null,
      performance: null,
      visual: null,
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
          totalRequests: 0,
          failedRequests: 0,
          transferSizeBytes: 0,
          resourceTypeBreakdown: {}
        }
      }
    }
  };
}

describe("phase4 markdown rendering", () => {
  it("renders trend ready state and deterministic page section ordering", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema:
        "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.1.0",
      mode: "multi",
      overallStatus: "fail",
      startedAt: "2026-02-08T00:00:00.000Z",
      durationMs: 2100,
      primaryUrl: "https://example.com/",
      rollup: {
        pageCount: 2,
        failedPages: 1,
        a11yViolations: 2,
        performanceBudgetFailures: 0,
        visualFailures: 0
      },
      pages: [createPage(0, "landing", "pass"), createPage(1, "checkout", "fail")],
      trend: {
        status: "ready",
        historyDir: ".wqg-history",
        previousSnapshotPath: ".wqg-history/2026-02-07T00-00-00-000Z.summary.v2.json",
        message: null,
        metrics: {
          overallStatusChanged: true,
          durationMs: { current: 2100, previous: 1900, delta: 200 },
          failedPages: { current: 1, previous: 0, delta: 1 },
          a11yViolations: { current: 2, previous: 0, delta: 2 },
          performanceBudgetFailures: { current: 0, previous: 0, delta: 0 },
          visualFailures: { current: 0, previous: 0, delta: 0 }
        },
        pages: [
          {
            name: "landing",
            url: "https://example.com/landing",
            statusChanged: false,
            a11yViolations: { current: 0, previous: 0, delta: 0 },
            performanceScore: { current: 0.9, previous: 0.9, delta: 0 },
            maxMismatchRatio: { current: 0.001, previous: 0.001, delta: 0 }
          }
        ]
      }
    } as never);

    expect(markdown).toContain("## Trend");
    expect(markdown).toContain("| Metric | Current | Previous | Delta |");
    expect(markdown).toContain(
      "| Page | URL | Status Changed | A11y Δ | Perf Score Δ | Visual Mismatch Δ |"
    );
    expect(markdown).toContain("## 1. landing");
    expect(markdown).toContain("## 2. checkout");

    const firstIndex = markdown.indexOf("## 1. landing");
    const secondIndex = markdown.indexOf("## 2. checkout");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("renders non-ready trend states compactly for PR-comment readability", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema:
        "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.1.0",
      mode: "single",
      overallStatus: "pass",
      startedAt: "2026-02-08T00:00:00.000Z",
      durationMs: 1000,
      primaryUrl: "https://example.com/",
      rollup: {
        pageCount: 1,
        failedPages: 0,
        a11yViolations: 0,
        performanceBudgetFailures: 0,
        visualFailures: 0
      },
      pages: [createPage(0, "landing", "pass")],
      trend: {
        status: "incompatible_previous",
        historyDir: ".wqg-history",
        previousSnapshotPath: null,
        message: "No compatible previous snapshot was found in trend history.",
        metrics: null,
        pages: []
      }
    } as never);

    expect(markdown).toContain("- **Status**: incompatible_previous");
    expect(markdown).toContain(
      "- **Details**: No compatible previous snapshot was found in trend history."
    );
    expect(markdown).not.toContain("### Per-Page Deltas");
    expect(markdown).toContain("https://img.shields.io/badge/");
  });

  it("maps legacy trend status aliases to canonical labels for compatibility rendering", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema:
        "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.1.0",
      mode: "single",
      overallStatus: "pass",
      startedAt: "2026-02-08T00:00:00.000Z",
      durationMs: 1000,
      primaryUrl: "https://example.com/",
      rollup: {
        pageCount: 1,
        failedPages: 0,
        a11yViolations: 0,
        performanceBudgetFailures: 0,
        visualFailures: 0
      },
      pages: [createPage(0, "landing", "pass")],
      trend: {
        status: "no_previous_snapshot",
        historyDir: ".wqg-history",
        previousSnapshotPath: null,
        message: "No previous snapshot is available yet.",
        metrics: null,
        pages: []
      }
    } as never);

    expect(markdown).toContain("- **Status**: no_previous");
    expect(markdown).not.toContain("no_previous_snapshot");
  });

  it("escapes target-derived Markdown in tables and headings", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema:
        "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.1.0",
      mode: "multi",
      overallStatus: "fail",
      startedAt: "2026-02-08T00:00:00.000Z",
      durationMs: 1000,
      primaryUrl: "https://example.com/?token=abc|def",
      rollup: {
        pageCount: 1,
        failedPages: 1,
        a11yViolations: 1,
        performanceBudgetFailures: 0,
        visualFailures: 0
      },
      pages: [
        {
          ...createPage(
            0,
            "Checkout | ![badge](https://bad.example)\n# injected <img src=x onerror=alert(1)>",
            "fail"
          ),
          url: "https://example.com/checkout?next=a|b&tag=<script>",
          details: {
            ...createPage(0, "checkout", "fail").details,
            insights: {
              recommendations: [
                {
                  id: "a11y-label",
                  source: "a11y|runtime",
                  severity: "high",
                  title: "Fix label | ![x](https://bad.example)",
                  expectedImpact: "Keeps table\nshape"
                }
              ]
            }
          }
        }
      ],
      trend: {
        status: "ready",
        historyDir: ".wqg-history",
        previousSnapshotPath: ".wqg-history/previous.summary.v2.json",
        message: null,
        metrics: {
          overallStatusChanged: true,
          durationMs: { current: 1000, previous: 900, delta: 100 },
          failedPages: { current: 1, previous: 0, delta: 1 },
          a11yViolations: { current: 1, previous: 0, delta: 1 },
          performanceBudgetFailures: { current: 0, previous: 0, delta: 0 },
          visualFailures: { current: 0, previous: 0, delta: 0 }
        },
        pages: [
          {
            name: "Checkout | ![trend](https://bad.example)",
            url: "https://example.com/checkout?next=a|b&tag=<script>",
            statusChanged: true,
            a11yViolations: { current: 1, previous: 0, delta: 1 },
            performanceScore: { current: 0.8, previous: 0.9, delta: -0.1 },
            maxMismatchRatio: { current: 0.001, previous: 0, delta: 0.001 }
          }
        ],
        insights: [
          {
            id: "trend",
            severity: "medium",
            title: "Trend | ![x](https://bad.example)",
            recommendation: "Review\nnow"
          }
        ]
      },
      insights: {
        recommendations: [
          {
            id: "rollup",
            source: "runtime|trend",
            severity: "medium",
            title: "Investigate | ![x](https://bad.example)",
            expectedImpact: "Cleaner\ncomments"
          }
        ]
      }
    } as never);

    expect(markdown).toContain(
      "Checkout \\| \\!\\[badge\\]\\(https://bad.example\\) \\# injected &lt;img src=x onerror=alert\\(1\\)&gt;"
    );
    expect(markdown).toContain("next=a\\|b&amp;tag=&lt;script&gt;");
    expect(markdown).not.toContain("## 1. Checkout | ![badge]");
    expect(markdown).not.toContain("| 1 | Checkout |");
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("a11y\\|runtime");
    expect(markdown).toContain("Fix label \\| \\!\\[x\\]\\(https://bad.example\\)");
    expect(markdown).toContain("Keeps table shape");
    expect(markdown).not.toContain("![x](https://bad.example)");
    expect(markdown).not.toContain("![trend](https://bad.example)");
  });

  it("keeps backticks inside Markdown code spans for artifact paths", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema:
        "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.1.0",
      mode: "multi",
      overallStatus: "pass",
      startedAt: "2026-02-08T00:00:00.000Z",
      durationMs: 1000,
      primaryUrl: "https://example.com/",
      rollup: {
        pageCount: 1,
        failedPages: 0,
        a11yViolations: 0,
        performanceBudgetFailures: 0,
        visualFailures: 0
      },
      pages: [
        {
          ...createPage(0, "landing", "pass"),
          artifacts: {
            summary: "pages/01-landing/summary`file.json",
            summaryV2: "pages/01-landing/summary``v2.json",
            report: "pages/01-landing/report`file.html"
          },
          details: {
            ...createPage(0, "landing", "pass").details,
            visual: {
              threshold: 0.01,
              failed: false,
              maxMismatchRatio: 0,
              results: [
                {
                  name: "landing",
                  currentPath: "screenshots/current`view.png",
                  baselinePath: "baselines/current``view.png",
                  diffPath: "diffs/current`view.png",
                  mismatchRatio: 0,
                  status: "diffed"
                }
              ]
            }
          }
        }
      ],
      trend: {
        status: "ready",
        historyDir: "trends/a`b",
        previousSnapshotPath: "trends/prev``snap.json",
        message: null,
        metrics: {
          overallStatusChanged: false,
          durationMs: { current: 1000, previous: 1000, delta: 0 },
          failedPages: { current: 0, previous: 0, delta: 0 },
          a11yViolations: { current: 0, previous: 0, delta: 0 },
          performanceBudgetFailures: { current: 0, previous: 0, delta: 0 },
          visualFailures: { current: 0, previous: 0, delta: 0 }
        },
        pages: []
      }
    } as never);

    expect(markdown).toContain("``trends/a`b``");
    expect(markdown).toContain("```trends/prev``snap.json```");
    expect(markdown).toContain("``pages/01-landing/summary`file.json``");
    expect(markdown).toContain("```pages/01-landing/summary``v2.json```");
    expect(markdown).toContain("``screenshots/current`view.png``");
    expect(markdown).toContain("```baselines/current``view.png```");
  });
});
