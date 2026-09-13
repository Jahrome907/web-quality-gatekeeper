import type { SummaryV2, InsightsSummary, RemediationInsight, InsightSeverity } from "./summary.js";

const DEFAULT_LIMIT = 10;

const A11Y_GUIDANCE: Record<string, { title: string; remediation: string[] }> = {
  "image-alt": {
    title: "Add meaningful alternative text",
    remediation: [
      "Add an `alt` attribute that communicates the image intent.",
      'Use `alt=""` for decorative-only images to avoid noisy announcements.'
    ]
  },
  "color-contrast": {
    title: "Improve text/background contrast",
    remediation: [
      "Increase contrast ratio to meet WCAG AA for text size.",
      "Check hover/focus/disabled states, not only default styles."
    ]
  },
  label: {
    title: "Associate form controls with labels",
    remediation: [
      "Connect inputs to visible labels with `for`/`id` or wrap input in label.",
      "Ensure placeholder text is not the only accessible label."
    ]
  }
};

const PERF_GUIDANCE: Record<string, { title: string; remediation: string[] }> = {
  "render-blocking-resources": {
    title: "Reduce render-blocking resources",
    remediation: [
      "Inline critical CSS and defer non-critical styles/scripts.",
      "Split large bundles and load route-level code lazily."
    ]
  },
  "unused-javascript": {
    title: "Cut unused JavaScript",
    remediation: [
      "Enable tree shaking and remove dead code or unused libraries.",
      "Prefer dynamic imports for low-priority interactions."
    ]
  },
  "modern-image-formats": {
    title: "Serve optimized images",
    remediation: [
      "Use AVIF/WebP where supported and keep responsive `srcset` variants.",
      "Compress large images and lazy-load below-the-fold content."
    ]
  }
};

function severityWeight(severity: InsightSeverity): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

interface RankedInsight {
  item: RemediationInsight;
  summary: SummaryV2;
}

function isGateFailure({ item, summary }: RankedInsight): boolean {
  switch (item.source) {
    case "a11y":
    case "visual":
      return summary.steps[item.source] === "fail";
    case "perf":
      return item.id === "perf:budgets" && summary.steps.perf === "fail";
    case "runtime":
      return summary.steps.playwright === "fail";
    default:
      return false;
  }
}

function compareInsights(left: RankedInsight, right: RankedInsight): number {
  const gateOrder = Number(isGateFailure(right)) - Number(isGateFailure(left));
  if (gateOrder !== 0) return gateOrder;

  const severityOrder = severityWeight(right.item.severity) - severityWeight(left.item.severity);
  if (severityOrder !== 0) return severityOrder;

  const leftOpportunity = left.summary.performance?.opportunities?.find(
    (opportunity) => left.item.id === `perf:${opportunity.id}`
  );
  const rightOpportunity = right.summary.performance?.opportunities?.find(
    (opportunity) => right.item.id === `perf:${opportunity.id}`
  );
  if (leftOpportunity && rightOpportunity) {
    const timeOrder =
      (rightOpportunity.estimatedSavingsMs ?? 0) - (leftOpportunity.estimatedSavingsMs ?? 0);
    const byteOrder =
      (rightOpportunity.estimatedSavingsBytes ?? 0) - (leftOpportunity.estimatedSavingsBytes ?? 0);
    if (timeOrder !== 0 || byteOrder !== 0) return timeOrder || byteOrder;
  }
  return left.item.id.localeCompare(right.item.id);
}

function rankInsights(entries: RankedInsight[], limit: number): InsightsSummary {
  const unique = new Map<string, RemediationInsight>();
  for (const { item } of entries.sort(compareInsights)) {
    if (!unique.has(item.id)) unique.set(item.id, item);
  }
  return { recommendations: [...unique.values()].slice(0, Math.max(1, limit)) };
}

export function aggregateInsights(summaries: SummaryV2[]): InsightsSummary | null {
  const entries = summaries.flatMap((summary) =>
    (summary.insights?.recommendations ?? []).map((item) => ({ item, summary }))
  );
  const budgetEntries = entries.filter(({ item }) => item.id === "perf:budgets");
  if (budgetEntries.length > 1) {
    const evidence = budgetEntries.flatMap(({ item }) => item.evidence);
    for (const entry of budgetEntries) entry.item = { ...entry.item, evidence };
  }
  return entries.length > 0 ? rankInsights(entries, DEFAULT_LIMIT) : null;
}

function toA11ySeverity(impact: string | null): InsightSeverity {
  switch ((impact ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "serious":
      return "high";
    case "moderate":
      return "medium";
    default:
      return "low";
  }
}

function formatOpportunitySavings(opportunity: {
  estimatedSavingsMs: number | null;
  estimatedSavingsBytes: number | null;
}): string {
  const values: string[] = [];
  if (opportunity.estimatedSavingsMs !== null) {
    values.push(`${Math.round(opportunity.estimatedSavingsMs)}ms`);
  }
  if (opportunity.estimatedSavingsBytes !== null) {
    values.push(`${Math.round(opportunity.estimatedSavingsBytes)} bytes`);
  }
  return values.length > 0 ? values.join(", ") : "not provided";
}

export function buildInsights(
  summary: SummaryV2,
  maxRecommendations: number = DEFAULT_LIMIT
): InsightsSummary {
  const recommendations: RemediationInsight[] = [];

  if (summary.steps.perf === "fail" && summary.performance) {
    const { metrics, budgets, budgetResults } = summary.performance;
    const evidence: string[] = [];
    if (!budgetResults.performance) {
      evidence.push(
        `Performance score: ${metrics.performanceScore}; minimum: ${budgets.performance}`
      );
    }
    if (!budgetResults.lcp) evidence.push(`LCP: ${metrics.lcpMs} ms; maximum: ${budgets.lcpMs} ms`);
    if (!budgetResults.cls) evidence.push(`CLS: ${metrics.cls}; maximum: ${budgets.cls}`);
    if (!budgetResults.tbt) evidence.push(`TBT: ${metrics.tbtMs} ms; maximum: ${budgets.tbtMs} ms`);
    if (evidence.length > 0) {
      recommendations.push({
        id: "perf:budgets",
        source: "perf",
        severity: "high",
        title: "Meet configured performance budgets",
        why: "These measured performance results failed the configured gate.",
        evidence: [`Page: ${summary.url}`, ...evidence],
        remediation: [
          "Inspect the Lighthouse report for the failed metrics and investigate their causes."
        ],
        verification: [
          "Re-run the audit under comparable conditions and check each failed budget."
        ],
        expectedImpact: "The performance gate passes when all configured budgets are met.",
        references: []
      });
    }
  }

  if (summary.a11y?.details) {
    for (const violation of summary.a11y.details) {
      const guidance = A11Y_GUIDANCE[violation.id];
      recommendations.push({
        id: `a11y:${violation.id}`,
        source: "a11y",
        severity: toA11ySeverity(violation.impact),
        title: guidance?.title ?? `Resolve accessibility rule ${violation.id}`,
        why: violation.description || "Accessibility violations block assistive technology users.",
        evidence: [
          `Rule: ${violation.id}`,
          `Impacted nodes: ${violation.nodes.length}`,
          ...(violation.wcagTags.length > 0 ? [`WCAG tags: ${violation.wcagTags.join(", ")}`] : [])
        ],
        remediation: guidance?.remediation ?? [
          violation.help || "Follow axe guidance for this rule."
        ],
        verification: [
          "Re-run WQG and confirm a11y violations decreased for this page.",
          "Validate impacted elements with keyboard + screen reader spot checks."
        ],
        expectedImpact: "Lower accessibility violation counts and improved audit pass rate.",
        references: violation.helpUrl ? [{ label: "Rule reference", url: violation.helpUrl }] : []
      });
    }
  }

  if (summary.performance?.opportunities) {
    for (const opportunity of summary.performance.opportunities) {
      const guidance = PERF_GUIDANCE[opportunity.id];
      const estimatedSavings = formatOpportunitySavings(opportunity);
      recommendations.push({
        id: `perf:${opportunity.id}`,
        source: "perf",
        severity: "low",
        title: guidance?.title ?? opportunity.title,
        why: "Optional performance improvement. This opportunity does not itself fail a configured budget.",
        evidence: [
          `Opportunity: ${opportunity.id}`,
          `Estimated savings: ${estimatedSavings}`,
          ...(opportunity.displayValue ? [`Display value: ${opportunity.displayValue}`] : [])
        ],
        remediation: guidance?.remediation ?? [
          "Apply the Lighthouse recommendation for this opportunity."
        ],
        verification: [
          "Re-run WQG under comparable conditions and compare the opportunity estimates and measured metrics."
        ],
        expectedImpact: `Lighthouse estimated savings: ${estimatedSavings}.`,
        references: []
      });
    }
  }

  if (summary.visual?.failed && summary.visual.results.length > 0) {
    for (const result of summary.visual.results) {
      if (result.mismatchRatio === null || result.mismatchRatio <= summary.visual.threshold) {
        continue;
      }
      recommendations.push({
        id: `visual:${result.name}`,
        source: "visual",
        severity: result.mismatchRatio > summary.visual.threshold * 2 ? "high" : "medium",
        title: `Investigate visual regression in ${result.name}`,
        why: "Visual mismatch exceeded the configured threshold.",
        evidence: [
          `Mismatch ratio: ${result.mismatchRatio.toFixed(4)}`,
          `Threshold: ${summary.visual.threshold.toFixed(4)}`,
          `Diff artifact: ${result.diffPath ?? "none"}`
        ],
        remediation: [
          "Review baseline/current/diff images to confirm intentional UI change.",
          "If intentional, update baseline; if not, fix CSS/layout regression.",
          "Add ignore regions only for known unstable dynamic zones."
        ],
        verification: [
          "Re-run WQG and confirm mismatch ratio is below threshold.",
          "Validate target viewport states (desktop/mobile) before merging."
        ],
        expectedImpact: "Fewer visual false positives and more stable release quality.",
        references: []
      });
    }
  }

  const runtimeIssues =
    summary.runtimeSignals.console.errorCount +
    summary.runtimeSignals.jsErrors.total +
    summary.runtimeSignals.network.failedRequests;
  if (runtimeIssues > 0) {
    recommendations.push({
      id: "runtime:errors",
      source: "runtime",
      severity: runtimeIssues >= 5 ? "high" : "medium",
      title: "Fix runtime and console errors",
      why: "Runtime errors often cause broken UX and can mask quality regressions.",
      evidence: [
        `Console errors: ${summary.runtimeSignals.console.errorCount}`,
        `JS errors: ${summary.runtimeSignals.jsErrors.total}`,
        `Failed network requests: ${summary.runtimeSignals.network.failedRequests}`
      ],
      remediation: [
        "Triage top repeated error signatures first.",
        "Fix failing requests and uncaught exceptions before tuning thresholds.",
        "Keep noisy third-party warnings out of the critical path when possible."
      ],
      verification: [
        "Re-run WQG and verify runtime error counts trend downward.",
        "Confirm affected flows still pass smoke steps and visual checks."
      ],
      expectedImpact: "Improved runtime stability and fewer downstream test failures.",
      references: []
    });
  }

  return rankInsights(
    recommendations.map((item) => ({ item, summary })),
    maxRecommendations
  );
}
