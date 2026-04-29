import { describe, expect, it } from "vitest";
import { buildActionPlanMarkdown } from "../src/report/actionPlan.js";
import type { InsightsSummary } from "../src/report/summary.js";

describe("buildActionPlanMarkdown", () => {
  it("includes trend insights when provided", () => {
    const insights: InsightsSummary = {
      recommendations: [
        {
          id: "runtime:errors",
          source: "runtime",
          severity: "medium",
          title: "Fix runtime and console errors",
          why: "Runtime errors often cause broken UX and can mask quality regressions.",
          evidence: ["Console errors: 4"],
          remediation: ["Triage top repeated error signatures first."],
          verification: ["Re-run WQG and verify runtime error counts trend downward."],
          expectedImpact: "Improved runtime stability and fewer downstream test failures.",
          references: []
        }
      ]
    };

    const markdown = buildActionPlanMarkdown(insights, [
      {
        id: "trend:perf-regression",
        severity: "medium",
        title: "Performance budget failures increased",
        recommendation: "Address high-savings Lighthouse opportunities before tightening budgets."
      }
    ]);

    expect(markdown).toContain("# Web Quality Gatekeeper Action Plan");
    expect(markdown).toContain("## 1. Fix runtime and console errors");
    expect(markdown).toContain("## Trend Insights");
    expect(markdown).toContain("### 1. Performance budget failures increased");
    expect(markdown).toContain("Address high-savings Lighthouse opportunities before tightening budgets.");
  });

  it("still emits trend-only output when prioritized recommendations are absent", () => {
    const markdown = buildActionPlanMarkdown(null, [
      {
        id: "trend:a11y-regression",
        severity: "high",
        title: "Accessibility violations increased",
        recommendation: "Prioritize top accessibility remediations for impacted pages."
      }
    ]);

    expect(markdown).toContain(
      "No prioritized accessibility, performance, visual, or runtime recommendations were generated."
    );
    expect(markdown).toContain("## Trend Insights");
    expect(markdown).toContain("Accessibility violations increased");
  });
});
