import type { SummaryV2, InsightsSummary, RemediationInsight, InsightSeverity } from "./summary.js";

const DEFAULT_LIMIT = 10;

const A11Y_GUIDANCE: Record<string, { title: string; remediation: string[] }> = {
  "image-alt": {
    title: "Add meaningful alternative text",
    remediation: [
      "Add an `alt` attribute that communicates the image intent.",
      "Use `alt=\"\"` for decorative-only images to avoid noisy announcements."
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

function scoreInsight(item: RemediationInsight): number {
  const evidenceBoost = Math.min(item.evidence.length, 5);
  return severityWeight(item.severity) * 10 + evidenceBoost;
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

export function buildInsights(summary: SummaryV2, maxRecommendations: number = DEFAULT_LIMIT): InsightsSummary {
  const recommendations: RemediationInsight[] = [];

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
        remediation: guidance?.remediation ?? [violation.help || "Follow axe guidance for this rule."],
        verification: [
          "Re-run WQG and confirm a11y violations decreased for this page.",
          "Validate impacted elements with keyboard + screen reader spot checks."
        ],
        expectedImpact: "Lower accessibility violation counts and improved audit pass rate.",
        references: violation.helpUrl
          ? [{ label: "Rule reference", url: violation.helpUrl }]
          : []
      });
    }
  }

  if (summary.performance?.opportunities) {
    for (const opportunity of summary.performance.opportunities) {
      const guidance = PERF_GUIDANCE[opportunity.id];
      const estimatedMs =
        opportunity.estimatedSavingsMs !== null ? `${Math.round(opportunity.estimatedSavingsMs)}ms` : "unknown";
      recommendations.push({
        id: `perf:${opportunity.id}`,
        source: "perf",
        severity: opportunity.score < 0.3 ? "high" : opportunity.score < 0.6 ? "medium" : "low",
        title: guidance?.title ?? opportunity.title,
        why: `Lighthouse flagged ${opportunity.title} as a user-perceived performance bottleneck.`,
        evidence: [
          `Opportunity: ${opportunity.id}`,
          `Estimated savings: ${estimatedMs}`,
          ...(opportunity.displayValue ? [`Display value: ${opportunity.displayValue}`] : [])
        ],
        remediation: guidance?.remediation ?? ["Apply the Lighthouse recommendation for this opportunity."],
        verification: [
          "Re-run WQG and verify Lighthouse opportunity savings are reduced.",
          "Confirm performance score and LCP trend improves over subsequent runs."
        ],
        expectedImpact: `Potential performance savings around ${estimatedMs}.`,
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

  const runtimeIssues = summary.runtimeSignals.console.errorCount + summary.runtimeSignals.jsErrors.total;
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

  const ranked = [...recommendations]
    .sort((left, right) => scoreInsight(right) - scoreInsight(left) || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, maxRecommendations));

  return { recommendations: ranked };
}
