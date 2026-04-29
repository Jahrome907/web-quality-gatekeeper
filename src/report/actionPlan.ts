import type { TrendInsight } from "../audit/orchestration.js";
import type { InsightsSummary } from "./summary.js";

export function buildActionPlanMarkdown(
  insights: InsightsSummary | null,
  trendInsights: TrendInsight[] = []
): string {
  const recommendations = insights?.recommendations ?? [];
  const lines: string[] = [];

  lines.push("# Web Quality Gatekeeper Action Plan");
  lines.push("");
  if (recommendations.length === 0 && trendInsights.length === 0) {
    lines.push("No prioritized recommendations were generated for this run.");
    lines.push("");
    return lines.join("\n");
  }

  if (recommendations.length === 0) {
    lines.push("No prioritized accessibility, performance, visual, or runtime recommendations were generated.");
    lines.push("");
  } else {
    recommendations.forEach((item, index) => {
      lines.push(`## ${index + 1}. ${item.title}`);
      lines.push("");
      lines.push(`- **Source**: ${item.source}`);
      lines.push(`- **Severity**: ${item.severity}`);
      lines.push(`- **Why it matters**: ${item.why}`);
      lines.push(`- **Expected impact**: ${item.expectedImpact}`);
      if (item.evidence.length > 0) {
        lines.push("- **Evidence**:");
        item.evidence.forEach((entry) => lines.push(`  - ${entry}`));
      }
      if (item.remediation.length > 0) {
        lines.push("- **Remediation steps**:");
        item.remediation.forEach((entry) => lines.push(`  - ${entry}`));
      }
      if (item.verification.length > 0) {
        lines.push("- **Verification**:");
        item.verification.forEach((entry) => lines.push(`  - ${entry}`));
      }
      lines.push("");
    });
  }

  if (trendInsights.length > 0) {
    lines.push("## Trend Insights");
    lines.push("");
    trendInsights.forEach((insight, index) => {
      lines.push(`### ${index + 1}. ${insight.title}`);
      lines.push("");
      lines.push(`- **Severity**: ${insight.severity}`);
      lines.push(`- **Recommendation**: ${insight.recommendation}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}
