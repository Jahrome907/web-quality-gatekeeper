import type { AxeSummary } from "../runner/axe.js";
import type { LighthouseSummary } from "../runner/lighthouse.js";
import type { VisualDiffSummary } from "../runner/visualDiff.js";
import type { ScreenshotResult } from "../runner/playwright.js";

export const SCHEMA_VERSION = "1.0.0";

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

export interface Summary {
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

export interface SummaryOptions {
  failOnA11y: boolean;
  failOnPerf: boolean;
  failOnVisual: boolean;
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
  const { a11y, performance, visual, options } = params;

  const a11yFail = Boolean(a11y && options.failOnA11y && a11y.violations > 0);
  const perfFail = Boolean(
    performance &&
      options.failOnPerf &&
      Object.values(performance.budgetResults).some((passed) => !passed)
  );
  const visualFail = Boolean(visual && options.failOnVisual && visual.failed);

  const steps: Summary["steps"] = {
    playwright: "pass",
    a11y: a11y ? (a11yFail ? "fail" : "pass") : "skipped",
    perf: performance ? (perfFail ? "fail" : "pass") : "skipped",
    visual: visual ? (visualFail ? "fail" : "pass") : "skipped"
  };

  const overallStatus = a11yFail || perfFail || visualFail ? "fail" : "pass";

  return {
    schemaVersion: SCHEMA_VERSION,
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
    visual: params.visual
  };
}
