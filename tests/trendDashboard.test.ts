import { describe, expect, it } from "vitest";
import { buildTrendDashboardHtml } from "../src/report/trendDashboard.js";
import type { TrendDeltaSummary } from "../src/audit/orchestration.js";

function makeTrend(overrides: Partial<TrendDeltaSummary> = {}): TrendDeltaSummary {
  return {
    status: "ready",
    historyDir: ".wqg-history",
    previousSnapshotPath: null,
    message: null,
    metrics: null,
    pages: [],
    history: {
      window: 1,
      points: [
        {
          startedAt: "2026-03-25T00:00:00.000Z",
          overallStatus: "pass",
          durationMs: 1000,
          failedPages: 0,
          a11yViolations: 0,
          performanceBudgetFailures: 0,
          visualFailures: 0
        }
      ]
    },
    insights: [
      {
        id: "trend:test",
        severity: "low",
        title: "Stable quality",
        recommendation: "Continue monitoring."
      }
    ],
    ...overrides
  };
}

describe("buildTrendDashboardHtml", () => {
  it("escapes untrusted text fields", () => {
    const html = buildTrendDashboardHtml(
      makeTrend({
        historyDir: "<img src=x onerror=alert(1)>",
        history: {
          window: 1,
          points: [
            {
              startedAt: "<script>alert(1)</script>",
              overallStatus: "pass",
              durationMs: 1000,
              failedPages: 0,
              a11yViolations: 0,
              performanceBudgetFailures: 0,
              visualFailures: 0
            }
          ]
        },
        insights: [
          {
            id: "trend:xss",
            severity: "low",
            title: "<svg/onload=alert(1)>",
            recommendation: "<b>fix now</b>"
          }
        ]
      })
    );

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;svg/onload=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;fix now&lt;/b&gt;");
  });
});
