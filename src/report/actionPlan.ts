import type { InsightsSummary } from "./summary.js";

export function buildActionPlanMarkdown(insights: InsightsSummary | null): string {
  const recommendations = insights?.recommendations ?? [];
  const lines: string[] = [];

  lines.push("# Web Quality Gatekeeper Action Plan");
  lines.push("");
  if (recommendations.length === 0) {
    lines.push("No prioritized recommendations were generated for this run.");
    lines.push("");
    return lines.join("\n");
  }

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

  return lines.join("\n");
}
