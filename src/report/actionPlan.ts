import type { TrendInsight } from "../audit/orchestration.js";
import type { InsightsSummary } from "./summary.js";

function escapeMarkdownText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ")
    .replace(/([[\]()`*_{}#!+|])/g, "\\$1");
}

export function buildActionPlanMarkdown(
  insights: InsightsSummary | null,
  trendInsights: TrendInsight[] = []
): string {
  const recommendations = insights?.recommendations ?? [];
  const lines: string[] = [];

  lines.push("# Web Quality Gatekeeper Action Plan");
  lines.push("");
  if (recommendations.length === 0 && trendInsights.length === 0) {
    lines.push("No prioritized recommendations are available for this run.");
    lines.push("");
    return lines.join("\n");
  }

  if (recommendations.length === 0) {
    lines.push(
      "No prioritized accessibility, performance, visual, or runtime recommendations are available."
    );
    lines.push("");
  } else {
    recommendations.forEach((item, index) => {
      lines.push(`## ${index + 1}. ${escapeMarkdownText(item.title)}`);
      lines.push("");
      lines.push(`- **Source**: ${escapeMarkdownText(item.source)}`);
      lines.push(`- **Severity**: ${escapeMarkdownText(item.severity)}`);
      lines.push(`- **Why it matters**: ${escapeMarkdownText(item.why)}`);
      lines.push(`- **Expected impact**: ${escapeMarkdownText(item.expectedImpact)}`);
      if (item.evidence.length > 0) {
        lines.push("- **Evidence**:");
        item.evidence.forEach((entry) => lines.push(`  - ${escapeMarkdownText(entry)}`));
      }
      if (item.remediation.length > 0) {
        lines.push("- **Remediation steps**:");
        item.remediation.forEach((entry) => lines.push(`  - ${escapeMarkdownText(entry)}`));
      }
      if (item.verification.length > 0) {
        lines.push("- **Verification**:");
        item.verification.forEach((entry) => lines.push(`  - ${escapeMarkdownText(entry)}`));
      }
      lines.push("");
    });
  }

  if (trendInsights.length > 0) {
    lines.push("## Trend Insights");
    lines.push("");
    trendInsights.forEach((insight, index) => {
      lines.push(`### ${index + 1}. ${escapeMarkdownText(insight.title)}`);
      lines.push("");
      lines.push(`- **Severity**: ${escapeMarkdownText(insight.severity)}`);
      lines.push(`- **Recommendation**: ${escapeMarkdownText(insight.recommendation)}`);
      lines.push("");
    });
  }

  return lines.join("\n");
}
