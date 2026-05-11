import type { AuditSummaryV2 } from "../audit/orchestration.js";
import type { InsightSeverity, InsightSource } from "./summary.js";

export const PR_RISK_LEDGER_ARTIFACT_NAMES = {
  json: "pr-risk-ledger.json",
  markdown: "pr-risk-ledger.md"
} as const;

export type PrRiskLedgerSeverity = "critical" | "high" | "medium" | "low";
export type PrRiskLedgerSource =
  | "a11y"
  | "perf"
  | "visual"
  | "runtime"
  | "trend"
  | "aggregate";

export interface PrRiskLedgerEntry {
  id: string;
  severity: PrRiskLedgerSeverity;
  source: PrRiskLedgerSource;
  title: string;
  affectedSurfaces: string[];
  evidence: string[];
  recommendedAction: string;
  verification: string;
}

export interface PrRiskLedger {
  generatedAt: string;
  toolVersion: string;
  overallStatus: AuditSummaryV2["overallStatus"];
  mode: AuditSummaryV2["mode"];
  primaryUrl: string;
  summaryPath: string;
  reportPath: string;
  riskCount: number;
  highestSeverity: PrRiskLedgerSeverity | "none";
  entries: PrRiskLedgerEntry[];
}

const SEVERITY_RANK: Record<PrRiskLedgerSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1
};

function toAffectedSurfaces(summary: AuditSummaryV2, predicate: (page: AuditSummaryV2["pages"][number]) => boolean): string[] {
  const surfaces = summary.pages
    .filter(predicate)
    .map((page) => `${page.name} (${page.url})`);
  return surfaces.length > 0 ? surfaces : [summary.primaryUrl];
}

function sumPageMetric(
  summary: AuditSummaryV2,
  selector: (page: AuditSummaryV2["pages"][number]) => number
): number {
  return summary.pages.reduce((total, page) => total + selector(page), 0);
}

function normalizeSeverity(severity: InsightSeverity): PrRiskLedgerSeverity {
  return severity;
}

function normalizeSource(source: InsightSource): PrRiskLedgerSource {
  return source;
}

function sortEntries(entries: PrRiskLedgerEntry[]): PrRiskLedgerEntry[] {
  return [...entries].sort((left, right) => {
    const severityDelta = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    return severityDelta === 0 ? left.id.localeCompare(right.id) : severityDelta;
  });
}

function highestSeverity(entries: PrRiskLedgerEntry[]): PrRiskLedger["highestSeverity"] {
  return entries.reduce<PrRiskLedger["highestSeverity"]>((highest, entry) => {
    if (highest === "none") {
      return entry.severity;
    }
    return SEVERITY_RANK[entry.severity] > SEVERITY_RANK[highest] ? entry.severity : highest;
  }, "none");
}

export function buildPrRiskLedger(summary: AuditSummaryV2): PrRiskLedger {
  const entries: PrRiskLedgerEntry[] = [];

  if (summary.rollup.failedPages > 0) {
    entries.push({
      id: "aggregate:failed-pages",
      severity: "high",
      source: "aggregate",
      title: `${summary.rollup.failedPages} audited page${summary.rollup.failedPages === 1 ? "" : "s"} failed the gate`,
      affectedSurfaces: toAffectedSurfaces(summary, (page) => page.overallStatus === "fail"),
      evidence: [
        `Overall status: ${summary.overallStatus}`,
        `Failed pages: ${summary.rollup.failedPages}/${summary.rollup.pageCount}`
      ],
      recommendedAction: "Review the failing page artifacts before merging.",
      verification: `Open ${summary.artifacts.report} and confirm each failed page has a matching remediation plan.`
    });
  }

  if (summary.rollup.a11yViolations > 0) {
    entries.push({
      id: "a11y:violations",
      severity: "high",
      source: "a11y",
      title: "Accessibility violations require triage",
      affectedSurfaces: toAffectedSurfaces(summary, (page) => page.metrics.a11yViolations > 0),
      evidence: [`A11y violations: ${summary.rollup.a11yViolations}`],
      recommendedAction: "Fix critical and serious accessibility issues first, then rerun the gate.",
      verification: "Confirm the next summary reports zero blocking accessibility violations."
    });
  }

  if (summary.rollup.performanceBudgetFailures > 0) {
    entries.push({
      id: "perf:budget-failures",
      severity: "medium",
      source: "perf",
      title: "Performance budgets failed",
      affectedSurfaces: toAffectedSurfaces(summary, (page) => page.steps.perf === "fail"),
      evidence: [`Performance budget failures: ${summary.rollup.performanceBudgetFailures}`],
      recommendedAction: "Inspect Lighthouse opportunities and adjust the page before relaxing budgets.",
      verification: "Rerun the audit and confirm all performance budget checks pass."
    });
  }

  if (summary.rollup.visualFailures > 0) {
    entries.push({
      id: "visual:diff-failures",
      severity: "medium",
      source: "visual",
      title: "Visual regression threshold exceeded",
      affectedSurfaces: toAffectedSurfaces(summary, (page) => page.steps.visual === "fail"),
      evidence: [`Visual failures: ${summary.rollup.visualFailures}`],
      recommendedAction: "Review diff artifacts and update baselines only for intentional UI changes.",
      verification: "Confirm the diff artifact matches an approved visual change or rerun after fixing the UI."
    });
  }

  const consoleErrors = sumPageMetric(summary, (page) => page.metrics.consoleErrors);
  const jsErrors = sumPageMetric(summary, (page) => page.metrics.jsErrors);
  const failedRequests = sumPageMetric(summary, (page) => page.metrics.failedRequests);
  if (consoleErrors > 0 || jsErrors > 0 || failedRequests > 0) {
    entries.push({
      id: "runtime:signals",
      severity: jsErrors > 0 || failedRequests > 0 ? "high" : "medium",
      source: "runtime",
      title: "Runtime signals need review",
      affectedSurfaces: toAffectedSurfaces(
        summary,
        (page) =>
          page.metrics.consoleErrors > 0 ||
          page.metrics.jsErrors > 0 ||
          page.metrics.failedRequests > 0
      ),
      evidence: [
        `Console errors: ${consoleErrors}`,
        `JavaScript errors: ${jsErrors}`,
        `Failed requests: ${failedRequests}`
      ],
      recommendedAction: "Resolve runtime errors and failed requests before treating the gate as healthy.",
      verification: "Rerun the audit and confirm runtime error and failed request counts return to zero."
    });
  }

  for (const insight of summary.insights?.recommendations ?? []) {
    entries.push({
      id: `insight:${insight.id}`,
      severity: normalizeSeverity(insight.severity),
      source: normalizeSource(insight.source),
      title: insight.title,
      affectedSurfaces: [summary.primaryUrl],
      evidence: insight.evidence,
      recommendedAction: insight.remediation.join(" "),
      verification: insight.verification.join(" ")
    });
  }

  for (const insight of summary.trend.insights) {
    entries.push({
      id: `trend:${insight.id}`,
      severity: insight.severity,
      source: "trend",
      title: insight.title,
      affectedSurfaces: [summary.primaryUrl],
      evidence: [summary.trend.message ?? `Trend status: ${summary.trend.status}`],
      recommendedAction: insight.recommendation,
      verification: "Rerun with trend history enabled and confirm the trend insight clears."
    });
  }

  const sortedEntries = sortEntries(entries);
  return {
    generatedAt: summary.startedAt,
    toolVersion: summary.toolVersion,
    overallStatus: summary.overallStatus,
    mode: summary.mode,
    primaryUrl: summary.primaryUrl,
    summaryPath: summary.artifacts.summaryV2,
    reportPath: summary.artifacts.report,
    riskCount: sortedEntries.length,
    highestSeverity: highestSeverity(sortedEntries),
    entries: sortedEntries
  };
}

export function formatPrRiskLedgerAsMarkdown(ledger: PrRiskLedger): string {
  const lines = [
    "# PR Risk Ledger",
    "",
    `- Overall status: **${ledger.overallStatus.toUpperCase()}**`,
    `- Highest severity: **${ledger.highestSeverity}**`,
    `- Risks: ${ledger.riskCount}`,
    `- Report: \`${ledger.reportPath}\``,
    `- Summary: \`${ledger.summaryPath}\``,
    ""
  ];

  if (ledger.entries.length === 0) {
    lines.push("No merge-risk entries were generated for this run.", "");
    return lines.join("\n");
  }

  for (const entry of ledger.entries) {
    lines.push(`## ${entry.severity.toUpperCase()} - ${entry.title}`);
    lines.push("");
    lines.push(`- Source: ${entry.source}`);
    lines.push(`- Affected surfaces: ${entry.affectedSurfaces.join("; ")}`);
    lines.push(`- Recommended action: ${entry.recommendedAction}`);
    lines.push(`- Verification: ${entry.verification}`);
    lines.push("- Evidence:");
    for (const evidence of entry.evidence) {
      lines.push(`  - ${evidence}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
