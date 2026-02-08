import type { Summary } from "./summary.js";

export function formatSummaryAsMarkdown(summary: Summary): string {
  const lines: string[] = [];
  const status = summary.overallStatus.toUpperCase();

  lines.push(`# Web Quality Gatekeeper Report`);
  lines.push("");
  lines.push(`- **Status**: ${status}`);
  lines.push(`- **URL**: ${summary.url}`);
  lines.push(`- **Duration**: ${summary.durationMs} ms`);
  lines.push(`- **Started**: ${summary.startedAt}`);
  lines.push("");

  lines.push("## Steps");
  lines.push("");
  lines.push("| Step | Status |");
  lines.push("|------|--------|");
  lines.push(`| Playwright | ${summary.steps.playwright} |`);
  lines.push(`| Accessibility | ${summary.steps.a11y} |`);
  lines.push(`| Performance | ${summary.steps.perf} |`);
  lines.push(`| Visual Regression | ${summary.steps.visual} |`);
  lines.push("");

  if (summary.a11y) {
    const { countsByImpact } = summary.a11y;
    lines.push("## Accessibility");
    lines.push("");
    lines.push(`- Total violations: ${summary.a11y.violations}`);
    lines.push(`- Critical: ${countsByImpact.critical}`);
    lines.push(`- Serious: ${countsByImpact.serious}`);
    lines.push(`- Moderate: ${countsByImpact.moderate}`);
    lines.push(`- Minor: ${countsByImpact.minor}`);
    lines.push("");
  }

  if (summary.performance) {
    const { metrics, budgets } = summary.performance;
    lines.push("## Performance");
    lines.push("");
    lines.push("| Metric | Value | Budget |");
    lines.push("|--------|-------|--------|");
    lines.push(`| Score | ${metrics.performanceScore} | >= ${budgets.performance} |`);
    lines.push(`| LCP | ${metrics.lcpMs} ms | <= ${budgets.lcpMs} ms |`);
    lines.push(`| CLS | ${metrics.cls} | <= ${budgets.cls} |`);
    lines.push(`| TBT | ${metrics.tbtMs} ms | <= ${budgets.tbtMs} ms |`);
    lines.push("");
  }

  if (summary.visual) {
    lines.push("## Visual Regression");
    lines.push("");
    lines.push(`- Max mismatch ratio: ${summary.visual.maxMismatchRatio.toFixed(4)}`);
    lines.push(`- Threshold: ${summary.visual.threshold}`);
    lines.push(`- Failed: ${summary.visual.failed}`);
    lines.push("");
  }

  return lines.join("\n");
}
