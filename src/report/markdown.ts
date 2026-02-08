import type { Summary, SummaryV2, StepStatus } from "./summary.js";

type OverallStatus = "pass" | "fail";

interface TrendNumericDelta {
  current: number;
  previous: number | null;
  delta: number | null;
}

interface TrendPageDelta {
  name: string;
  url: string;
  statusChanged: boolean;
  a11yViolations: TrendNumericDelta;
  performanceScore: TrendNumericDelta;
  maxMismatchRatio: TrendNumericDelta;
}

interface TrendDeltaSummary {
  status:
    | "disabled"
    | "no_previous"
    | "incompatible_previous"
    | "corrupt_previous"
    | "no_previous_snapshot"
    | "previous_snapshot_invalid"
    | "ready";
  historyDir: string | null;
  previousSnapshotPath: string | null;
  message: string | null;
  metrics: {
    overallStatusChanged: boolean;
    durationMs: TrendNumericDelta;
    failedPages: TrendNumericDelta;
    a11yViolations: TrendNumericDelta;
    performanceBudgetFailures: TrendNumericDelta;
    visualFailures: TrendNumericDelta;
  } | null;
  pages: TrendPageDelta[];
}

interface PageSummaryEntry {
  index: number;
  name: string;
  url: string;
  overallStatus: OverallStatus;
  startedAt: string;
  durationMs: number;
  steps: Summary["steps"];
  artifacts: {
    summary: string;
    summaryV2: string;
    report: string;
  };
  metrics: {
    a11yViolations: number;
    performanceScore: number | null;
    maxMismatchRatio: number | null;
    consoleErrors: number;
    jsErrors: number;
    failedRequests: number;
  };
  details: SummaryV2;
}

interface SummaryV2Rollup {
  pageCount: number;
  failedPages: number;
  a11yViolations: number;
  performanceBudgetFailures: number;
  visualFailures: number;
}

interface AggregateSummaryV2Like {
  $schema: string;
  schemaVersion: string;
  mode: "single" | "multi";
  overallStatus: OverallStatus;
  startedAt: string;
  durationMs: number;
  primaryUrl: string;
  rollup: SummaryV2Rollup;
  pages: PageSummaryEntry[];
  trend: TrendDeltaSummary;
}

const BADGE_COLORS: Record<StepStatus | OverallStatus, string> = {
  pass: "brightgreen",
  fail: "red",
  skipped: "lightgrey"
};

function badge(label: string, status: StepStatus | OverallStatus): string {
  const color = BADGE_COLORS[status];
  const encodedLabel = encodeURIComponent(label);
  const encodedStatus = encodeURIComponent(status.toUpperCase());
  return `![${label}: ${status.toUpperCase()}](https://img.shields.io/badge/${encodedLabel}-${encodedStatus}-${color})`;
}

function formatNumber(value: number, digits: number = 2): string {
  return Number(value.toFixed(digits)).toString();
}

function formatDelta(delta: number | null): string {
  if (delta === null) {
    return "n/a";
  }
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatNumber(delta, 3)}`;
}

function normalizeTrendStatus(status: TrendDeltaSummary["status"]): Exclude<
  TrendDeltaSummary["status"],
  "no_previous_snapshot" | "previous_snapshot_invalid"
> {
  switch (status) {
    case "no_previous_snapshot":
      return "no_previous";
    case "previous_snapshot_invalid":
      return "incompatible_previous";
    default:
      return status;
  }
}

function formatTrendStatus(status: TrendDeltaSummary["status"]): string {
  return normalizeTrendStatus(status);
}

function isAggregateSummary(summary: MarkdownSummary): summary is AggregateSummaryV2Like {
  const candidate = summary as Partial<AggregateSummaryV2Like>;
  return (
    Boolean(candidate) &&
    typeof candidate.schemaVersion === "string" &&
    candidate.schemaVersion.startsWith("2.") &&
    Array.isArray(candidate.pages) &&
    Boolean(candidate.rollup)
  );
}

function renderStepTable(lines: string[], steps: Summary["steps"]): void {
  lines.push("| Step | Status | Badge |");
  lines.push("|---|---|---|");
  lines.push(`| Playwright | ${steps.playwright} | ${badge("Playwright", steps.playwright)} |`);
  lines.push(`| Accessibility | ${steps.a11y} | ${badge("Accessibility", steps.a11y)} |`);
  lines.push(`| Performance | ${steps.perf} | ${badge("Performance", steps.perf)} |`);
  lines.push(`| Visual Regression | ${steps.visual} | ${badge("Visual", steps.visual)} |`);
  lines.push("");
}

function renderTrendSection(lines: string[], trend: TrendDeltaSummary): void {
  lines.push("## Trend");
  lines.push("");
  const normalizedStatus = normalizeTrendStatus(trend.status);

  if (normalizedStatus !== "ready" || !trend.metrics) {
    lines.push(`- **Status**: ${formatTrendStatus(normalizedStatus)}`);
    if (trend.historyDir) {
      lines.push(`- **History directory**: \`${trend.historyDir}\``);
    }
    if (trend.message) {
      lines.push(`- **Details**: ${trend.message}`);
    }
    lines.push("");
    return;
  }

  lines.push(`- **History directory**: \`${trend.historyDir ?? "n/a"}\``);
  lines.push(`- **Previous snapshot**: \`${trend.previousSnapshotPath ?? "n/a"}\``);
  lines.push(`- **Overall status changed**: ${trend.metrics.overallStatusChanged ? "yes" : "no"}`);
  lines.push("");

  lines.push("| Metric | Current | Previous | Delta |");
  lines.push("|---|---:|---:|---:|");
  lines.push(
    `| Duration (ms) | ${formatNumber(trend.metrics.durationMs.current)} | ${
      trend.metrics.durationMs.previous ?? "n/a"
    } | ${formatDelta(trend.metrics.durationMs.delta)} |`
  );
  lines.push(
    `| Failed pages | ${formatNumber(trend.metrics.failedPages.current)} | ${
      trend.metrics.failedPages.previous ?? "n/a"
    } | ${formatDelta(trend.metrics.failedPages.delta)} |`
  );
  lines.push(
    `| A11y violations | ${formatNumber(trend.metrics.a11yViolations.current)} | ${
      trend.metrics.a11yViolations.previous ?? "n/a"
    } | ${formatDelta(trend.metrics.a11yViolations.delta)} |`
  );
  lines.push(
    `| Perf budget failures | ${formatNumber(trend.metrics.performanceBudgetFailures.current)} | ${
      trend.metrics.performanceBudgetFailures.previous ?? "n/a"
    } | ${formatDelta(trend.metrics.performanceBudgetFailures.delta)} |`
  );
  lines.push(
    `| Visual failures | ${formatNumber(trend.metrics.visualFailures.current)} | ${
      trend.metrics.visualFailures.previous ?? "n/a"
    } | ${formatDelta(trend.metrics.visualFailures.delta)} |`
  );
  lines.push("");

  if (trend.pages.length > 0) {
    lines.push("### Per-Page Deltas");
    lines.push("");
    lines.push("| Page | URL | Status Changed | A11y Δ | Perf Score Δ | Visual Mismatch Δ |");
    lines.push("|---|---|---|---:|---:|---:|");
    for (const page of trend.pages) {
      lines.push(
        `| ${page.name} | ${page.url} | ${page.statusChanged ? "yes" : "no"} | ${formatDelta(
          page.a11yViolations.delta
        )} | ${formatDelta(page.performanceScore.delta)} | ${formatDelta(page.maxMismatchRatio.delta)} |`
      );
    }
    lines.push("");
  }
}

function renderAggregateSummary(summary: AggregateSummaryV2Like): string {
  const lines: string[] = [];

  lines.push("# Web Quality Gatekeeper Report");
  lines.push("");
  lines.push(`${badge("Overall", summary.overallStatus)}`);
  lines.push("");
  lines.push(`- **Mode**: ${summary.mode}`);
  lines.push(`- **Started**: ${summary.startedAt}`);
  lines.push(`- **Duration**: ${summary.durationMs} ms`);
  lines.push(`- **Primary URL**: ${summary.primaryUrl}`);
  lines.push(`- **Schema**: \`${summary.$schema}\``);
  lines.push(`- **Schema version**: \`${summary.schemaVersion}\``);
  lines.push("");

  lines.push("## Rollup");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Pages audited | ${summary.rollup.pageCount} |`);
  lines.push(`| Failed pages | ${summary.rollup.failedPages} |`);
  lines.push(`| A11y violations | ${summary.rollup.a11yViolations} |`);
  lines.push(`| Performance budget failures | ${summary.rollup.performanceBudgetFailures} |`);
  lines.push(`| Visual failures | ${summary.rollup.visualFailures} |`);
  lines.push("");

  renderTrendSection(lines, summary.trend);

  lines.push("## Pages");
  lines.push("");
  lines.push(
    "| # | Name | URL | Status | A11y Violations | Perf Score | Max Visual Mismatch | Duration (ms) |"
  );
  lines.push("|---:|---|---|---|---:|---:|---:|---:|");
  for (const page of summary.pages) {
    lines.push(
      `| ${page.index + 1} | ${page.name} | ${page.url} | ${badge("Page", page.overallStatus)} | ${
        page.metrics.a11yViolations
      } | ${page.metrics.performanceScore ?? "n/a"} | ${
        page.metrics.maxMismatchRatio === null ? "n/a" : formatNumber(page.metrics.maxMismatchRatio, 4)
      } | ${page.durationMs} |`
    );
  }
  lines.push("");

  for (const page of summary.pages) {
    const details = page.details;
    lines.push(`## ${page.index + 1}. ${page.name}`);
    lines.push("");
    lines.push(`- **URL**: ${page.url}`);
    lines.push(`- **Status**: ${badge("Page", page.overallStatus)}`);
    lines.push(`- **Started**: ${page.startedAt}`);
    lines.push(`- **Duration**: ${page.durationMs} ms`);
    lines.push(`- **Summary (v1)**: \`${page.artifacts.summary}\``);
    lines.push(`- **Summary (v2)**: \`${page.artifacts.summaryV2}\``);
    lines.push(`- **Report**: \`${page.artifacts.report}\``);
    lines.push("");

    lines.push("### Step Status");
    lines.push("");
    renderStepTable(lines, page.steps);

    if (details.a11y) {
      const { countsByImpact } = details.a11y;
      lines.push("### Accessibility");
      lines.push("");
      lines.push("| Metric | Value |");
      lines.push("|---|---:|");
      lines.push(`| Violations | ${details.a11y.violations} |`);
      lines.push(`| Critical | ${countsByImpact.critical} |`);
      lines.push(`| Serious | ${countsByImpact.serious} |`);
      lines.push(`| Moderate | ${countsByImpact.moderate} |`);
      lines.push(`| Minor | ${countsByImpact.minor} |`);
      lines.push("");
    }

    if (details.performance) {
      const { metrics, budgets, budgetResults } = details.performance;
      lines.push("### Performance");
      lines.push("");
      lines.push("| Metric | Value | Budget | Status |");
      lines.push("|---|---:|---:|---|");
      lines.push(
        `| Score | ${metrics.performanceScore} | >= ${budgets.performance} | ${badge(
          "Perf Score",
          budgetResults.performance ? "pass" : "fail"
        )} |`
      );
      lines.push(
        `| LCP (ms) | ${metrics.lcpMs} | <= ${budgets.lcpMs} | ${badge(
          "LCP",
          budgetResults.lcp ? "pass" : "fail"
        )} |`
      );
      lines.push(
        `| CLS | ${metrics.cls} | <= ${budgets.cls} | ${badge(
          "CLS",
          budgetResults.cls ? "pass" : "fail"
        )} |`
      );
      lines.push(
        `| TBT (ms) | ${metrics.tbtMs} | <= ${budgets.tbtMs} | ${badge(
          "TBT",
          budgetResults.tbt ? "pass" : "fail"
        )} |`
      );
      lines.push("");
    }

    if (details.visual) {
      lines.push("### Visual Views");
      lines.push("");
      lines.push(`- **Threshold**: ${details.visual.threshold}`);
      lines.push(`- **Max mismatch ratio**: ${formatNumber(details.visual.maxMismatchRatio, 4)}`);
      lines.push(`- **Visual gate failed**: ${details.visual.failed ? "yes" : "no"}`);
      lines.push("");
      lines.push("| View | Status | Mismatch Ratio | Current | Baseline | Diff |");
      lines.push("|---|---|---:|---|---|---|");
      for (const result of details.visual.results) {
        lines.push(
          `| ${result.name} | ${result.status} | ${
            result.mismatchRatio === null ? "n/a" : formatNumber(result.mismatchRatio, 4)
          } | \`${result.currentPath}\` | \`${result.baselinePath}\` | \`${
            result.diffPath ?? "n/a"
          }\` |`
        );
      }
      lines.push("");
    }

    lines.push("### Runtime Signals");
    lines.push("");
    lines.push("| Signal | Value |");
    lines.push("|---|---:|");
    lines.push(`| Console messages | ${details.runtimeSignals.console.total} |`);
    lines.push(`| Console errors | ${details.runtimeSignals.console.errorCount} |`);
    lines.push(`| JS errors | ${details.runtimeSignals.jsErrors.total} |`);
    lines.push(`| Failed requests | ${details.runtimeSignals.network.failedRequests} |`);
    lines.push(`| Network requests | ${details.runtimeSignals.network.totalRequests} |`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderLegacySummary(summary: Summary): string {
  const lines: string[] = [];
  const status = summary.overallStatus;

  lines.push("# Web Quality Gatekeeper Report");
  lines.push("");
  lines.push(`${badge("Overall", status)}`);
  lines.push("");
  lines.push(`- **URL**: ${summary.url}`);
  lines.push(`- **Duration**: ${summary.durationMs} ms`);
  lines.push(`- **Started**: ${summary.startedAt}`);
  lines.push(`- **Schema version**: \`${summary.schemaVersion}\``);
  lines.push("");

  lines.push("## Steps");
  lines.push("");
  renderStepTable(lines, summary.steps);

  if (summary.a11y) {
    const { countsByImpact } = summary.a11y;
    lines.push("## Accessibility");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---:|");
    lines.push(`| Total violations | ${summary.a11y.violations} |`);
    lines.push(`| Critical | ${countsByImpact.critical} |`);
    lines.push(`| Serious | ${countsByImpact.serious} |`);
    lines.push(`| Moderate | ${countsByImpact.moderate} |`);
    lines.push(`| Minor | ${countsByImpact.minor} |`);
    lines.push("");
  }

  if (summary.performance) {
    const { metrics, budgets, budgetResults } = summary.performance;
    lines.push("## Performance");
    lines.push("");
    lines.push("| Metric | Value | Budget | Status |");
    lines.push("|---|---:|---:|---|");
    lines.push(
      `| Score | ${metrics.performanceScore} | >= ${budgets.performance} | ${badge(
        "Perf Score",
        budgetResults.performance ? "pass" : "fail"
      )} |`
    );
    lines.push(
      `| LCP (ms) | ${metrics.lcpMs} | <= ${budgets.lcpMs} | ${badge(
        "LCP",
        budgetResults.lcp ? "pass" : "fail"
      )} |`
    );
    lines.push(
      `| CLS | ${metrics.cls} | <= ${budgets.cls} | ${badge(
        "CLS",
        budgetResults.cls ? "pass" : "fail"
      )} |`
    );
    lines.push(
      `| TBT (ms) | ${metrics.tbtMs} | <= ${budgets.tbtMs} | ${badge(
        "TBT",
        budgetResults.tbt ? "pass" : "fail"
      )} |`
    );
    lines.push("");
  }

  if (summary.visual) {
    lines.push("## Visual Regression");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---:|");
    lines.push(`| Max mismatch ratio | ${formatNumber(summary.visual.maxMismatchRatio, 4)} |`);
    lines.push(`| Threshold | ${summary.visual.threshold} |`);
    lines.push(`| Failed | ${summary.visual.failed ? "yes" : "no"} |`);
    lines.push("");
  }

  return lines.join("\n");
}

type MarkdownSummary = Summary | SummaryV2 | AggregateSummaryV2Like;

export function formatSummaryAsMarkdown(summary: MarkdownSummary): string {
  if (isAggregateSummary(summary)) {
    return renderAggregateSummary(summary);
  }
  return renderLegacySummary(summary as Summary);
}
