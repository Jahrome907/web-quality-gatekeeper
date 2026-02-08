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
      $schema: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.0.0",
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
    expect(markdown).toContain("| Page | URL | Status Changed | A11y Δ | Perf Score Δ | Visual Mismatch Δ |");
    expect(markdown).toContain("## 1. landing");
    expect(markdown).toContain("## 2. checkout");

    const firstIndex = markdown.indexOf("## 1. landing");
    const secondIndex = markdown.indexOf("## 2. checkout");
    expect(firstIndex).toBeGreaterThan(-1);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("renders non-ready trend states compactly for PR-comment readability", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.0.0",
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
    expect(markdown).toContain("- **Details**: No compatible previous snapshot was found in trend history.");
    expect(markdown).not.toContain("### Per-Page Deltas");
    expect(markdown).toContain("https://img.shields.io/badge/");
  });

  it("maps legacy trend status aliases to canonical labels for compatibility rendering", () => {
    const markdown = formatSummaryAsMarkdown({
      $schema: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
      schemaVersion: "2.0.0",
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
});
