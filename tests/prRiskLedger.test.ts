import { describe, expect, it } from "vitest";
import {
  buildPrRiskLedger,
  formatPrRiskLedgerAsMarkdown
} from "../src/report/prRiskLedger.js";
import type { AuditSummaryV2 } from "../src/audit/orchestration.js";

function createSummary(): AuditSummaryV2 {
  return {
    $schema: "https://example.com/summary.v2.json",
    schemaVersion: "2.2.0",
    toolVersion: "3.1.5",
    mode: "multi",
    overallStatus: "fail",
    startedAt: "2026-05-11T20:00:00.000Z",
    durationMs: 1200,
    primaryUrl: "https://example.com/",
    schemaPointers: {
      v1: "v1",
      v2: "v2"
    },
    schemaVersions: {
      v1: "1.1.0",
      v2: "2.2.0"
    },
    compatibility: {
      v1SummaryPath: "summary.json",
      v1Schema: "v1",
      v1SchemaVersion: "1.1.0",
      note: "summary.json remains v1-compatible"
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
      failedPages: 1,
      a11yViolations: 2,
      performanceBudgetFailures: 1,
      visualFailures: 0
    },
    pages: [
      {
        index: 0,
        name: "home",
        url: "https://example.com/",
        overallStatus: "fail",
        startedAt: "2026-05-11T20:00:00.000Z",
        durationMs: 800,
        steps: {
          playwright: "pass",
          a11y: "fail",
          perf: "fail",
          visual: "pass"
        },
        artifacts: {
          summary: "pages/home/summary.json",
          summaryV2: "pages/home/summary.v2.json",
          report: "pages/home/report.html"
        },
        metrics: {
          a11yViolations: 2,
          performanceScore: 0.62,
          maxMismatchRatio: 0,
          consoleErrors: 1,
          jsErrors: 0,
          failedRequests: 0
        },
        details: {} as never
      },
      {
        index: 1,
        name: "pricing",
        url: "https://example.com/pricing",
        overallStatus: "pass",
        startedAt: "2026-05-11T20:00:01.000Z",
        durationMs: 400,
        steps: {
          playwright: "pass",
          a11y: "pass",
          perf: "pass",
          visual: "pass"
        },
        artifacts: {
          summary: "pages/pricing/summary.json",
          summaryV2: "pages/pricing/summary.v2.json",
          report: "pages/pricing/report.html"
        },
        metrics: {
          a11yViolations: 0,
          performanceScore: 0.94,
          maxMismatchRatio: 0,
          consoleErrors: 0,
          jsErrors: 0,
          failedRequests: 0
        },
        details: {} as never
      }
    ],
    trend: {
      status: "ready",
      historyDir: "trends",
      previousSnapshotPath: "trends/previous.json",
      message: "Compared with previous snapshot.",
      metrics: null,
      pages: [],
      history: null,
      insights: [
        {
          id: "perf-regression",
          severity: "medium",
          title: "Performance regressed",
          recommendation: "Review new render-blocking work."
        }
      ]
    },
    insights: {
      recommendations: [
        {
          id: "a11y-button-name",
          source: "a11y",
          severity: "high",
          title: "Button lacks an accessible name",
          why: "Screen reader users need a label.",
          evidence: ["button-name violation on home"],
          remediation: ["Add an accessible label."],
          verification: ["Rerun axe and confirm the violation clears."],
          expectedImpact: "Improves checkout accessibility.",
          references: []
        }
      ]
    }
  };
}

describe("PR Risk Ledger", () => {
  it("builds deterministic merge-risk entries from aggregate summary data", () => {
    const ledger = buildPrRiskLedger(createSummary());

    expect(ledger.riskCount).toBe(6);
    expect(ledger.highestSeverity).toBe("high");
    expect(ledger.entries.map((entry) => entry.id)).toEqual([
      "a11y:violations",
      "aggregate:failed-pages",
      "insight:a11y-button-name",
      "perf:budget-failures",
      "runtime:signals",
      "trend:perf-regression"
    ]);
    expect(ledger.entries[1]?.affectedSurfaces).toEqual(["home (https://example.com/)"]);
  });

  it("formats markdown from the ledger object", () => {
    const ledger = buildPrRiskLedger(createSummary());
    const markdown = formatPrRiskLedgerAsMarkdown(ledger);

    expect(markdown).toContain("# PR Risk Ledger");
    expect(markdown).toContain("- Overall status: **FAIL**");
    expect(markdown).toContain("## HIGH - 1 audited page failed the gate");
    expect(markdown).toContain("- Report: `report.html`");
    expect(markdown).toContain("button-name violation on home");
  });
});
