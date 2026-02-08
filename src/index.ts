import path from "node:path";
import { createRequire } from "node:module";
import { readdir, readFile, unlink } from "node:fs/promises";
import { loadConfig } from "./config/loadConfig.js";
import { openPage, captureScreenshots } from "./runner/playwright.js";
import { runAxeScan } from "./runner/axe.js";
import { runLighthouseAudit } from "./runner/lighthouse.js";
import { runVisualDiff } from "./runner/visualDiff.js";
import * as summaryReport from "./report/summary.js";
import { buildHtmlReport } from "./report/html.js";
import {
  ensureDir,
  pathExists,
  validateOutputDirectory,
  writeJson,
  writeText
} from "./utils/fs.js";
import { createLogger } from "./utils/logger.js";
import { durationMs, nowIso } from "./utils/timing.js";
import { validateUrl, UsageError } from "./utils/url.js";
import type { Config, TrendSettings, UrlTarget } from "./config/schema.js";
import type { AxeSummary } from "./runner/axe.js";
import type { LighthouseSummary } from "./runner/lighthouse.js";
import type { VisualDiffSummary } from "./runner/visualDiff.js";
import type { RuntimeSignalSummary } from "./runner/playwright.js";
import type { AuditAuth } from "./utils/auth.js";
import type { StepStatus, Summary, SummaryV2 } from "./report/summary.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const DEFAULT_TREND_HISTORY_DIR = ".wqg-history";
const DEFAULT_TREND_MAX_SNAPSHOTS = 90;
// Temporary compatibility fallback for partial summary-module mocks.
// Owner: Agent 1 (Coordinator tracking).
// Removal condition: drop after test and consumer code always provides
// SCHEMA_VERSION*, SUMMARY_SCHEMA_URI*, and buildSummaryV2 from report/summary.
const SUMMARY_SCHEMA_URI_V1_FALLBACK =
  "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json";
const SUMMARY_SCHEMA_URI_V2_FALLBACK =
  "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json";
const SCHEMA_VERSION_V1_FALLBACK = "1.1.0";
const SCHEMA_VERSION_V2_FALLBACK = "2.0.0";

type OverallStatus = "pass" | "fail";

export type { Summary, SummaryV2 } from "./report/summary.js";
export { SCHEMA_VERSION } from "./report/summary.js";
export type { Config } from "./config/schema.js";

export interface AuditOptions {
  config: string;
  out: string;
  baselineDir: string;
  setBaseline: boolean;
  failOnA11y: boolean;
  failOnPerf: boolean;
  failOnVisual: boolean;
  verbose: boolean;
  format?: string;
  auth?: AuditAuth | null;
}

interface ResolvedAuditTarget {
  index: number;
  name: string;
  url: string;
  outDir: string;
  baselineDir: string;
}

interface TargetAuditResult {
  target: ResolvedAuditTarget;
  summary: Summary;
  summaryV2: SummaryV2;
}

export interface TrendNumericDelta {
  current: number;
  previous: number | null;
  delta: number | null;
}

export interface TrendPageDelta {
  name: string;
  url: string;
  statusChanged: boolean;
  a11yViolations: TrendNumericDelta;
  performanceScore: TrendNumericDelta;
  maxMismatchRatio: TrendNumericDelta;
}

export interface TrendDeltaSummary {
  status:
    | "disabled"
    | "no_previous"
    | "incompatible_previous"
    | "corrupt_previous"
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

export interface SummaryV2Rollup {
  pageCount: number;
  failedPages: number;
  a11yViolations: number;
  performanceBudgetFailures: number;
  visualFailures: number;
}

export interface PageSummaryEntry {
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

export interface AuditSummaryV2 {
  $schema: string;
  schemaVersion: string;
  toolVersion: string;
  mode: "single" | "multi";
  overallStatus: OverallStatus;
  startedAt: string;
  durationMs: number;
  primaryUrl: string;
  schemaPointers: {
    v1: string;
    v2: string;
  };
  schemaVersions: {
    v1: string;
    v2: string;
  };
  compatibility: {
    v1SummaryPath: string;
    v1Schema: string;
    v1SchemaVersion: string;
    note: string;
  };
  rollup: SummaryV2Rollup;
  pages: PageSummaryEntry[];
  trend: TrendDeltaSummary;
}

interface LoadedTrendSnapshot {
  snapshot: AuditSummaryV2 | null;
  path: string | null;
  hadCorruptSnapshot: boolean;
  hadIncompatibleSnapshot: boolean;
}

function toRelative(outDir: string, filePath: string): string {
  const rel = path.relative(outDir, filePath);
  return rel.split(path.sep).join("/");
}

function toSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "page";
}

function toTrendDelta(current: number, previous: number | null): TrendNumericDelta {
  return {
    current,
    previous,
    delta: previous === null ? null : Number((current - previous).toFixed(6))
  };
}

function resolveTrendSettings(config: Config): Required<TrendSettings> {
  return {
    enabled: config.trends?.enabled ?? false,
    historyDir: config.trends?.historyDir ?? DEFAULT_TREND_HISTORY_DIR,
    maxSnapshots: config.trends?.maxSnapshots ?? DEFAULT_TREND_MAX_SNAPSHOTS
  };
}

function normalizeTarget(raw: string, logger: ReturnType<typeof createLogger>): string {
  const { url, isInternal } = validateUrl(raw);
  if (isInternal) {
    const hostname = new URL(url).hostname;
    logger.warn(
      `Auditing internal network address (${hostname}). ` +
        `Ensure this is intentional. See SECURITY.md for SSRF guidance.`
    );
  }
  return url;
}

function resolveTargets(
  inputUrl: string | undefined,
  config: Config,
  outDir: string,
  baselineDir: string,
  logger: ReturnType<typeof createLogger>
): ResolvedAuditTarget[] {
  const configuredTargets: UrlTarget[] = config.urls ?? [];
  if (configuredTargets.length === 0 && !inputUrl) {
    throw new UsageError("URL argument is required when config.urls is not configured");
  }

  const sourceTargets =
    configuredTargets.length > 0
      ? configuredTargets
      : [
          {
            url: inputUrl as string,
            name: "default"
          }
        ];

  const isMulti = sourceTargets.length > 1;
  return sourceTargets.map((target, index) => {
    const normalizedUrl = normalizeTarget(target.url, logger);
    const slugBase = `${String(index + 1).padStart(2, "0")}-${toSlug(target.name)}`;
    const targetOutDir = isMulti ? path.join(outDir, "pages", slugBase) : outDir;
    const targetBaselineDir = isMulti ? path.join(baselineDir, "pages", slugBase) : baselineDir;

    return {
      index,
      name: target.name,
      url: normalizedUrl,
      outDir: targetOutDir,
      baselineDir: targetBaselineDir
    };
  });
}

function aggregateStepStatus(statuses: StepStatus[]): StepStatus {
  if (statuses.some((status) => status === "fail")) {
    return "fail";
  }
  if (statuses.every((status) => status === "skipped")) {
    return "skipped";
  }
  return "pass";
}

function aggregateSteps(results: TargetAuditResult[]): Summary["steps"] {
  return {
    playwright: aggregateStepStatus(results.map((result) => result.summary.steps.playwright)),
    a11y: aggregateStepStatus(results.map((result) => result.summary.steps.a11y)),
    perf: aggregateStepStatus(results.map((result) => result.summary.steps.perf)),
    visual: aggregateStepStatus(results.map((result) => result.summary.steps.visual))
  };
}

function countPerformanceBudgetFailures(summary: SummaryV2): number {
  if (!summary.performance) {
    return 0;
  }
  return Object.values(summary.performance.budgetResults).filter((passed) => !passed).length;
}

function buildPageEntry(result: TargetAuditResult): PageSummaryEntry {
  const { summary, summaryV2, target } = result;
  return {
    index: target.index,
    name: target.name,
    url: target.url,
    overallStatus: summaryV2.overallStatus,
    startedAt: summaryV2.startedAt,
    durationMs: summaryV2.durationMs,
    steps: summaryV2.steps,
    artifacts: {
      summary: summary.artifacts.summary,
      summaryV2: summaryV2.artifacts.summaryV2,
      report: summary.artifacts.report
    },
    metrics: {
      a11yViolations: summaryV2.a11y?.violations ?? 0,
      performanceScore: summaryV2.performance?.metrics.performanceScore ?? null,
      maxMismatchRatio: summaryV2.visual?.maxMismatchRatio ?? null,
      consoleErrors: summaryV2.runtimeSignals.console.errorCount,
      jsErrors: summaryV2.runtimeSignals.jsErrors.total,
      failedRequests: summaryV2.runtimeSignals.network.failedRequests
    },
    details: summaryV2
  };
}

function buildRollup(pages: PageSummaryEntry[]): SummaryV2Rollup {
  return {
    pageCount: pages.length,
    failedPages: pages.filter((page) => page.overallStatus === "fail").length,
    a11yViolations: pages.reduce((sum, page) => sum + page.metrics.a11yViolations, 0),
    performanceBudgetFailures: pages.reduce(
      (sum, page) => sum + countPerformanceBudgetFailures(page.details),
      0
    ),
    visualFailures: pages.filter((page) => page.details.visual?.failed ?? false).length
  };
}

function isAuditSummaryV2(value: unknown): value is AuditSummaryV2 {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AuditSummaryV2>;
  return (
    typeof candidate.schemaVersion === "string" &&
    candidate.schemaVersion.startsWith("2.") &&
    Array.isArray(candidate.pages) &&
    Boolean(candidate.rollup && typeof candidate.rollup.pageCount === "number")
  );
}

async function loadLatestTrendSnapshot(
  historyDir: string,
  logger: ReturnType<typeof createLogger>
): Promise<LoadedTrendSnapshot> {
  if (!(await pathExists(historyDir))) {
    return {
      snapshot: null,
      path: null,
      hadCorruptSnapshot: false,
      hadIncompatibleSnapshot: false
    };
  }

  const entries = await readdir(historyDir, { withFileTypes: true });
  const snapshotFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".summary.v2.json"))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));

  let hadCorruptSnapshot = false;
  let hadIncompatibleSnapshot = false;

  for (const fileName of snapshotFiles) {
    const absolutePath = path.join(historyDir, fileName);
    try {
      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (isAuditSummaryV2(parsed)) {
        return {
          snapshot: parsed,
          path: absolutePath,
          hadCorruptSnapshot,
          hadIncompatibleSnapshot
        };
      }
      hadIncompatibleSnapshot = true;
      logger.warn(`Ignoring incompatible trend snapshot: ${fileName}`);
    } catch {
      hadCorruptSnapshot = true;
      logger.warn(`Ignoring corrupt trend snapshot: ${fileName}`);
    }
  }

  return {
    snapshot: null,
    path: null,
    hadCorruptSnapshot,
    hadIncompatibleSnapshot
  };
}

function buildTrendSummary(
  current: AuditSummaryV2,
  previous: LoadedTrendSnapshot,
  outDir: string,
  historyDir: string,
  enabled: boolean
): TrendDeltaSummary {
  if (!enabled) {
    return {
      status: "disabled",
      historyDir: null,
      previousSnapshotPath: null,
      message: null,
      metrics: null,
      pages: []
    };
  }

  const historyDirRel = toRelative(outDir, historyDir);
  if (!previous.snapshot) {
    let status: TrendDeltaSummary["status"] = "no_previous";
    let message = "No previous snapshot is available yet.";
    if (previous.hadCorruptSnapshot) {
      status = "corrupt_previous";
      message = "No valid previous snapshot was found because one or more snapshots were corrupt.";
    } else if (previous.hadIncompatibleSnapshot) {
      status = "incompatible_previous";
      message = "No compatible previous snapshot was found in trend history.";
    }

    return {
      status,
      historyDir: historyDirRel,
      previousSnapshotPath: null,
      message,
      metrics: null,
      pages: []
    };
  }

  const previousSnapshot = previous.snapshot;
  // Pages are matched by stable identity key "name::url" for trend deltas.
  const previousPageMap = new Map<string, PageSummaryEntry>(
    previousSnapshot.pages.map((page) => [`${page.name}::${page.url}`, page] as const)
  );

  const pageDeltas: TrendPageDelta[] = current.pages.map((page) => {
    const key = `${page.name}::${page.url}`;
    const previousPage = previousPageMap.get(key);

    return {
      name: page.name,
      url: page.url,
      statusChanged: Boolean(previousPage && previousPage.overallStatus !== page.overallStatus),
      a11yViolations: toTrendDelta(page.metrics.a11yViolations, previousPage?.metrics.a11yViolations ?? null),
      performanceScore: toTrendDelta(
        page.metrics.performanceScore ?? 0,
        previousPage?.metrics.performanceScore ?? null
      ),
      maxMismatchRatio: toTrendDelta(
        page.metrics.maxMismatchRatio ?? 0,
        previousPage?.metrics.maxMismatchRatio ?? null
      )
    };
  });

  return {
    status: "ready",
    historyDir: historyDirRel,
    previousSnapshotPath: previous.path ? toRelative(outDir, previous.path) : null,
    message: null,
    metrics: {
      overallStatusChanged: current.overallStatus !== previousSnapshot.overallStatus,
      durationMs: toTrendDelta(current.durationMs, previousSnapshot.durationMs),
      failedPages: toTrendDelta(current.rollup.failedPages, previousSnapshot.rollup.failedPages),
      a11yViolations: toTrendDelta(
        current.rollup.a11yViolations,
        previousSnapshot.rollup.a11yViolations
      ),
      performanceBudgetFailures: toTrendDelta(
        current.rollup.performanceBudgetFailures,
        previousSnapshot.rollup.performanceBudgetFailures
      ),
      visualFailures: toTrendDelta(current.rollup.visualFailures, previousSnapshot.rollup.visualFailures)
    },
    pages: pageDeltas
  };
}

async function writeTrendSnapshot(
  historyDir: string,
  summaryV2: AuditSummaryV2,
  maxSnapshots: number
): Promise<void> {
  await ensureDir(historyDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = path.join(historyDir, `${timestamp}.summary.v2.json`);
  await writeJson(snapshotPath, summaryV2);

  const files = (await readdir(historyDir))
    .filter((entry) => entry.endsWith(".summary.v2.json"))
    .sort((left, right) => left.localeCompare(right));

  while (files.length > maxSnapshots) {
    const oldest = files.shift();
    if (!oldest) {
      break;
    }
    await unlink(path.join(historyDir, oldest));
  }
}

async function runTargetAudit(params: {
  target: ResolvedAuditTarget;
  outDir: string;
  config: Config;
  options: AuditOptions;
  logger: ReturnType<typeof createLogger>;
}): Promise<TargetAuditResult> {
  const { target, config, options, logger, outDir } = params;

  const screenshotsDir = path.join(target.outDir, "screenshots");
  const diffsDir = path.join(target.outDir, "diffs");
  const summaryPath = path.join(target.outDir, "summary.json");
  const summaryV2Path = path.join(target.outDir, "summary.v2.json");
  const reportPath = path.join(target.outDir, "report.html");

  await ensureDir(target.outDir);
  await ensureDir(screenshotsDir);
  await ensureDir(diffsDir);

  const startedAt = nowIso();
  const startTime = Date.now();

  let axeSummary: AxeSummary | null = null;
  let lighthouseSummary: LighthouseSummary | null = null;
  let visualSummary: VisualDiffSummary | null = null;

  const { browser, page, runtimeSignals } = await openPage(target.url, config, logger, options.auth ?? null);
  try {
    if (config.toggles.a11y) {
      axeSummary = await runAxeScan(page, target.outDir, logger, config);
    }

    const screenshots = await captureScreenshots(page, target.url, config, screenshotsDir, logger);

    if (config.toggles.perf) {
      lighthouseSummary = await runLighthouseAudit(
        target.url,
        target.outDir,
        config,
        logger,
        options.auth ?? null
      );
    }

    if (config.toggles.visual) {
      visualSummary = await runVisualDiff(
        screenshots,
        target.baselineDir,
        diffsDir,
        options.setBaseline,
        config.visual.threshold,
        logger
      );
    }

    const relativeScreenshots = screenshots.map((shot) => ({
      ...shot,
      path: toRelative(outDir, shot.path)
    }));

    const relativeA11yV2 = axeSummary
      ? { ...axeSummary, reportPath: toRelative(outDir, axeSummary.reportPath) }
      : null;
    const relativeA11y = relativeA11yV2
      ? {
          violations: relativeA11yV2.violations,
          countsByImpact: relativeA11yV2.countsByImpact,
          reportPath: relativeA11yV2.reportPath
        }
      : null;

    const relativePerfV2 = lighthouseSummary
      ? { ...lighthouseSummary, reportPath: toRelative(outDir, lighthouseSummary.reportPath) }
      : null;
    const relativePerf = relativePerfV2
      ? {
          metrics: relativePerfV2.metrics,
          budgets: relativePerfV2.budgets,
          budgetResults: relativePerfV2.budgetResults,
          reportPath: relativePerfV2.reportPath
        }
      : null;

    const relativeVisual = visualSummary
      ? {
          ...visualSummary,
          results: visualSummary.results.map((result) => ({
            ...result,
            currentPath: toRelative(outDir, result.currentPath),
            baselinePath: toRelative(outDir, result.baselinePath),
            diffPath: result.diffPath ? toRelative(outDir, result.diffPath) : null
          }))
        }
      : null;

    const artifacts = {
      summary: toRelative(outDir, summaryPath),
      report: toRelative(outDir, reportPath),
      axe: relativeA11y?.reportPath ?? null,
      lighthouse: relativePerf?.reportPath ?? null,
      screenshotsDir: toRelative(outDir, screenshotsDir),
      diffsDir: toRelative(outDir, diffsDir),
      baselineDir: toRelative(outDir, target.baselineDir)
    };

    const runDurationMs = durationMs(startTime);
    const summary = summaryReport.buildSummary({
      url: target.url,
      startedAt,
      durationMs: runDurationMs,
      toolVersion: pkg.version,
      screenshots: relativeScreenshots,
      a11y: relativeA11y,
      performance: relativePerf,
      visual: relativeVisual,
      artifacts,
      options: {
        failOnA11y: options.failOnA11y,
        failOnPerf: options.failOnPerf,
        failOnVisual: options.failOnVisual
      }
    });

    const summaryV2 = summaryReport.buildSummaryV2
      ? summaryReport.buildSummaryV2({
          url: target.url,
          startedAt,
          durationMs: runDurationMs,
          toolVersion: pkg.version,
          screenshots: relativeScreenshots,
          a11y: relativeA11yV2,
          performance: relativePerfV2,
          visual: relativeVisual,
          runtimeSignals: runtimeSignals.snapshot() as RuntimeSignalSummary,
          artifacts: {
            ...artifacts,
            summaryV2: toRelative(outDir, summaryV2Path)
          },
          options: {
            failOnA11y: options.failOnA11y,
            failOnPerf: options.failOnPerf,
            failOnVisual: options.failOnVisual
          }
        })
      : ({
          ...summary,
          artifacts: {
            ...summary.artifacts,
            summaryV2: toRelative(outDir, summaryV2Path)
          },
          runtimeSignals: runtimeSignals.snapshot() as RuntimeSignalSummary
        } as SummaryV2);

    await writeJson(summaryPath, summary);
    await writeJson(summaryV2Path, summaryV2);
    await writeText(reportPath, buildHtmlReport(summary));

    return {
      target,
      summary,
      summaryV2
    };
  } finally {
    await browser.close();
  }
}

export async function runAudit(
  url: string | undefined,
  options: AuditOptions
): Promise<{ exitCode: number; summary: Summary; summaryV2: AuditSummaryV2 }> {
  const configPath = path.resolve(process.cwd(), options.config);
  const outDir = path.resolve(process.cwd(), options.out);
  const baselineDir = path.resolve(process.cwd(), options.baselineDir);

  validateOutputDirectory(outDir);
  validateOutputDirectory(baselineDir);

  const logger = createLogger(options.verbose);
  const config = await loadConfig(configPath);
  const targets = resolveTargets(url, config, outDir, baselineDir, logger);

  await ensureDir(outDir);

  const startedAt = nowIso();
  const startTime = Date.now();
  const results: TargetAuditResult[] = [];

  for (const target of targets) {
    logger.debug(`Running audit target ${target.index + 1}/${targets.length}: ${target.name} (${target.url})`);
    const result = await runTargetAudit({
      target,
      outDir,
      config,
      options,
      logger
    });
    results.push(result);
  }

  const overallStatus: OverallStatus = results.some((result) => result.summary.overallStatus === "fail")
    ? "fail"
    : "pass";

  const compatibilitySummary: Summary = {
    ...results[0]!.summary,
    overallStatus,
    durationMs: durationMs(startTime),
    steps: aggregateSteps(results),
    artifacts: {
      ...results[0]!.summary.artifacts,
      summary: "summary.json",
      report: "report.html"
    }
  };

  await writeJson(path.join(outDir, "summary.json"), compatibilitySummary);
  await writeText(path.join(outDir, "report.html"), buildHtmlReport(compatibilitySummary));

  const pages = results.map((result) => buildPageEntry(result));
  const rollup = buildRollup(pages);

  const trendSettings = resolveTrendSettings(config);
  const trendHistoryDir = path.isAbsolute(trendSettings.historyDir)
    ? trendSettings.historyDir
    : path.resolve(outDir, trendSettings.historyDir);

  if (trendSettings.enabled) {
    validateOutputDirectory(trendHistoryDir);
  }

  const summaryV2: AuditSummaryV2 = {
    $schema: summaryReport.SUMMARY_SCHEMA_URI_V2 ?? SUMMARY_SCHEMA_URI_V2_FALLBACK,
    schemaVersion: summaryReport.SCHEMA_VERSION_V2 ?? SCHEMA_VERSION_V2_FALLBACK,
    toolVersion: pkg.version,
    mode: pages.length > 1 ? "multi" : "single",
    overallStatus,
    startedAt,
    durationMs: compatibilitySummary.durationMs,
    primaryUrl: pages[0]!.url,
    schemaPointers: {
      v1: summaryReport.SUMMARY_SCHEMA_URI ?? SUMMARY_SCHEMA_URI_V1_FALLBACK,
      v2: summaryReport.SUMMARY_SCHEMA_URI_V2 ?? SUMMARY_SCHEMA_URI_V2_FALLBACK
    },
    schemaVersions: {
      v1: summaryReport.SCHEMA_VERSION ?? SCHEMA_VERSION_V1_FALLBACK,
      v2: summaryReport.SCHEMA_VERSION_V2 ?? SCHEMA_VERSION_V2_FALLBACK
    },
    compatibility: {
      v1SummaryPath: "summary.json",
      v1Schema: summaryReport.SUMMARY_SCHEMA_URI ?? SUMMARY_SCHEMA_URI_V1_FALLBACK,
      v1SchemaVersion: summaryReport.SCHEMA_VERSION ?? SCHEMA_VERSION_V1_FALLBACK,
      note: "summary.json remains v1-compatible. summary.v2.json contains multipage and trend fields."
    },
    rollup,
    pages,
    trend: {
      status: "disabled",
      historyDir: null,
      previousSnapshotPath: null,
      message: null,
      metrics: null,
      pages: []
    }
  };

  if (trendSettings.enabled) {
    const previous = await loadLatestTrendSnapshot(trendHistoryDir, logger);
    summaryV2.trend = buildTrendSummary(summaryV2, previous, outDir, trendHistoryDir, true);
  }

  await writeJson(path.join(outDir, "summary.v2.json"), summaryV2);

  if (trendSettings.enabled) {
    await writeTrendSnapshot(trendHistoryDir, summaryV2, trendSettings.maxSnapshots);
  }

  const exitCode = overallStatus === "fail" ? 1 : 0;
  return { exitCode, summary: compatibilitySummary, summaryV2 };
}
