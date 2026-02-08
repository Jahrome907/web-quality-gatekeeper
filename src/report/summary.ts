import type { AxeSummary } from "../runner/axe.js";
import type { LighthouseSummary } from "../runner/lighthouse.js";
import type { VisualDiffSummary } from "../runner/visualDiff.js";
import type { RuntimeSignalSummary, ScreenshotResult } from "../runner/playwright.js";

export const SCHEMA_VERSION = "1.1.0";
export const SUMMARY_SCHEMA_URI =
  "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json";

export const SCHEMA_VERSION_V2 = "2.0.0";
export const SUMMARY_SCHEMA_URI_V2 =
  "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json";

export type StepStatus = "pass" | "fail" | "skipped";

export interface ArtifactPaths {
  summary: string;
  report: string;
  axe: string | null;
  lighthouse: string | null;
  screenshotsDir: string;
  diffsDir: string;
  baselineDir: string;
}

export interface ArtifactPathsV2 extends ArtifactPaths {
  summaryV2: string;
}

export interface Summary {
  $schema: string;
  schemaVersion: string;
  toolVersion: string;
  overallStatus: "pass" | "fail";
  url: string;
  startedAt: string;
  durationMs: number;
  steps: {
    playwright: StepStatus;
    a11y: StepStatus;
    perf: StepStatus;
    visual: StepStatus;
  };
  artifacts: ArtifactPaths;
  screenshots: ScreenshotResult[];
  a11y: AxeSummary | null;
  performance: LighthouseSummary | null;
  visual: VisualDiffSummary | null;
}

export interface SummaryV2 {
  $schema: string;
  schemaVersion: string;
  toolVersion: string;
  overallStatus: "pass" | "fail";
  url: string;
  startedAt: string;
  durationMs: number;
  steps: {
    playwright: StepStatus;
    a11y: StepStatus;
    perf: StepStatus;
    visual: StepStatus;
  };
  artifacts: ArtifactPathsV2;
  screenshots: ScreenshotResult[];
  a11y: AxeSummary | null;
  performance: LighthouseSummary | null;
  visual: VisualDiffSummary | null;
  runtimeSignals: RuntimeSignalSummary;
}

export interface SummaryOptions {
  failOnA11y: boolean;
  failOnPerf: boolean;
  failOnVisual: boolean;
}

interface StatusComputationResult {
  overallStatus: "pass" | "fail";
  steps: {
    playwright: StepStatus;
    a11y: StepStatus;
    perf: StepStatus;
    visual: StepStatus;
  };
}

function computeStatuses(
  a11y: AxeSummary | null,
  performance: LighthouseSummary | null,
  visual: VisualDiffSummary | null,
  options: SummaryOptions
): StatusComputationResult {
  const a11yFail = Boolean(a11y && options.failOnA11y && a11y.violations > 0);
  const perfFail = Boolean(
    performance &&
      options.failOnPerf &&
      Object.values(performance.budgetResults).some((passed) => !passed)
  );
  const visualFail = Boolean(visual && options.failOnVisual && visual.failed);

  const steps: StatusComputationResult["steps"] = {
    playwright: "pass",
    a11y: a11y ? (a11yFail ? "fail" : "pass") : "skipped",
    perf: performance ? (perfFail ? "fail" : "pass") : "skipped",
    visual: visual ? (visualFail ? "fail" : "pass") : "skipped"
  };

  const overallStatus = a11yFail || perfFail || visualFail ? "fail" : "pass";
  return { overallStatus, steps };
}

function toV1A11ySummary(a11y: AxeSummary | null): Summary["a11y"] {
  if (!a11y) {
    return null;
  }
  return {
    violations: a11y.violations,
    countsByImpact: a11y.countsByImpact,
    reportPath: a11y.reportPath
  };
}

function toV1PerformanceSummary(performance: LighthouseSummary | null): Summary["performance"] {
  if (!performance) {
    return null;
  }
  return {
    metrics: performance.metrics,
    budgets: performance.budgets,
    budgetResults: performance.budgetResults,
    reportPath: performance.reportPath
  };
}

export function buildSummary(params: {
  url: string;
  startedAt: string;
  durationMs: number;
  toolVersion: string;
  screenshots: ScreenshotResult[];
  a11y: AxeSummary | null;
  performance: LighthouseSummary | null;
  visual: VisualDiffSummary | null;
  artifacts: ArtifactPaths;
  options: SummaryOptions;
}): Summary {
  const { overallStatus, steps } = computeStatuses(
    params.a11y,
    params.performance,
    params.visual,
    params.options
  );

  return {
    $schema: SUMMARY_SCHEMA_URI,
    schemaVersion: SCHEMA_VERSION,
    toolVersion: params.toolVersion,
    overallStatus,
    url: params.url,
    startedAt: params.startedAt,
    durationMs: params.durationMs,
    steps,
    artifacts: params.artifacts,
    screenshots: params.screenshots,
    a11y: toV1A11ySummary(params.a11y),
    performance: toV1PerformanceSummary(params.performance),
    visual: params.visual
  };
}

export function buildSummaryV2(params: {
  url: string;
  startedAt: string;
  durationMs: number;
  toolVersion: string;
  screenshots: ScreenshotResult[];
  a11y: AxeSummary | null;
  performance: LighthouseSummary | null;
  visual: VisualDiffSummary | null;
  runtimeSignals: RuntimeSignalSummary;
  artifacts: ArtifactPathsV2;
  options: SummaryOptions;
}): SummaryV2 {
  const { overallStatus, steps } = computeStatuses(
    params.a11y,
    params.performance,
    params.visual,
    params.options
  );

  return {
    $schema: SUMMARY_SCHEMA_URI_V2,
    schemaVersion: SCHEMA_VERSION_V2,
    toolVersion: params.toolVersion,
    overallStatus,
    url: params.url,
    startedAt: params.startedAt,
    durationMs: params.durationMs,
    steps,
    artifacts: params.artifacts,
    screenshots: params.screenshots,
    a11y: params.a11y,
    performance: params.performance,
    visual: params.visual,
    runtimeSignals: params.runtimeSignals
  };
}
