import path from "node:path";
import { readdir, readFile, unlink } from "node:fs/promises";
import type { Config, UrlTarget } from "../config/schema.js";
import { ensureDir, pathExists, writeJson } from "../utils/fs.js";
import { resolveAuditedTarget, type TargetResolutionPolicy, UsageError } from "../utils/url.js";
import type { StepStatus, Summary, SummaryV2 } from "../report/summary.js";

const DEFAULT_TREND_HISTORY_DIR = ".wqg-history";
const DEFAULT_TREND_MAX_SNAPSHOTS = 90;
const DEFAULT_TREND_DASHBOARD_WINDOW = 30;

type WarningLogger = {
  warn: (message: string) => void;
};

type OverallStatus = "pass" | "fail";

export interface ResolvedAuditTarget {
  index: number;
  name: string;
  url: string;
  outDir: string;
  baselineDir: string;
  hostResolverRules: string | null;
}

export interface TargetAuditResult {
  target: ResolvedAuditTarget;
  summary: Summary;
  summaryV2: SummaryV2;
}

export interface TrendNumericDelta {
  current: number | null;
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
  history: {
    window: number;
    points: TrendHistoryPoint[];
  } | null;
  insights: TrendInsight[];
}

export interface TrendHistoryPoint {
  startedAt: string;
  overallStatus: OverallStatus;
  durationMs: number;
  failedPages: number;
  a11yViolations: number;
  performanceBudgetFailures: number;
  visualFailures: number;
}

export interface TrendInsight {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  recommendation: string;
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
  artifacts: {
    summary: string;
    summaryV2: string;
    report: string;
    trendDashboardHtml: string | null;
    trendHistoryJson: string | null;
    actionPlanMd: string | null;
  };
  rollup: SummaryV2Rollup;
  pages: PageSummaryEntry[];
  trend: TrendDeltaSummary;
  insights: SummaryV2["insights"];
}

export interface LoadedTrendSnapshot {
  snapshot: AuditSummaryV2 | null;
  path: string | null;
  hadCorruptSnapshot: boolean;
  hadIncompatibleSnapshot: boolean;
}

export interface ResolvedTrendSettings {
  enabled: boolean;
  historyDir: string;
  maxSnapshots: number;
  dashboardWindow: number;
}

export function toRelative(outDir: string, filePath: string): string {
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

function toNullableTrendDelta(current: number | null, previous: number | null): TrendNumericDelta {
  if (current === null) {
    return {
      current: null,
      previous,
      delta: null
    };
  }
  return toTrendDelta(current, previous);
}

export function resolveTrendSettings(config: Config): ResolvedTrendSettings {
  return {
    enabled: config.trends?.enabled ?? false,
    historyDir: config.trends?.historyDir ?? DEFAULT_TREND_HISTORY_DIR,
    maxSnapshots: config.trends?.maxSnapshots ?? DEFAULT_TREND_MAX_SNAPSHOTS,
    dashboardWindow: config.trends?.dashboard?.window ?? DEFAULT_TREND_DASHBOARD_WINDOW
  };
}

export async function resolveTargets(
  inputUrl: string | undefined,
  config: Config,
  outDir: string,
  baselineDir: string,
  logger: WarningLogger,
  policy: TargetResolutionPolicy
): Promise<ResolvedAuditTarget[]> {
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
  return Promise.all(sourceTargets.map(async (target, index) => {
    const normalizedTarget = await resolveAuditedTarget(target.url, logger, policy);
    const slugBase = `${String(index + 1).padStart(2, "0")}-${toSlug(target.name)}`;
    const targetOutDir = isMulti ? path.join(outDir, "pages", slugBase) : outDir;
    const targetBaselineDir = isMulti ? path.join(baselineDir, "pages", slugBase) : baselineDir;

    return {
      index,
      name: target.name,
      url: normalizedTarget.url,
      outDir: targetOutDir,
      baselineDir: targetBaselineDir,
      hostResolverRules: normalizedTarget.hostResolverRules
    };
  }));
}

function toHistoryPoint(snapshot: AuditSummaryV2): TrendHistoryPoint {
  return {
    startedAt: snapshot.startedAt,
    overallStatus: snapshot.overallStatus,
    durationMs: snapshot.durationMs,
    failedPages: snapshot.rollup.failedPages,
    a11yViolations: snapshot.rollup.a11yViolations,
    performanceBudgetFailures: snapshot.rollup.performanceBudgetFailures,
    visualFailures: snapshot.rollup.visualFailures
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isOverallStatus(value: unknown): value is OverallStatus {
  return value === "pass" || value === "fail";
}

function isTrendPageSummaryCandidate(value: unknown): value is {
  name: string;
  url: string;
  overallStatus: OverallStatus;
  metrics: {
    a11yViolations: number;
    performanceScore: number | null;
    maxMismatchRatio: number | null;
  };
} {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    name?: unknown;
    url?: unknown;
    overallStatus?: unknown;
    metrics?: {
      a11yViolations?: unknown;
      performanceScore?: unknown;
      maxMismatchRatio?: unknown;
    };
  };

  return (
    typeof candidate.name === "string" &&
    typeof candidate.url === "string" &&
    isOverallStatus(candidate.overallStatus) &&
    Boolean(candidate.metrics) &&
    isFiniteNumber(candidate.metrics?.a11yViolations) &&
    isNullableFiniteNumber(candidate.metrics?.performanceScore) &&
    isNullableFiniteNumber(candidate.metrics?.maxMismatchRatio)
  );
}

function buildTrendInsights(points: TrendHistoryPoint[]): TrendInsight[] {
  if (points.length < 2) {
    return [];
  }

  const insights: TrendInsight[] = [];
  const latest = points[points.length - 1]!;
  const previous = points[points.length - 2]!;

  if (latest.a11yViolations > previous.a11yViolations) {
    insights.push({
      id: "trend:a11y-regression",
      severity: "high",
      title: "Accessibility violations increased",
      recommendation: "Prioritize top accessibility remediations for impacted pages."
    });
  }

  if (latest.performanceBudgetFailures > previous.performanceBudgetFailures) {
    insights.push({
      id: "trend:perf-regression",
      severity: "medium",
      title: "Performance budget failures increased",
      recommendation: "Address high-savings Lighthouse opportunities before tightening budgets."
    });
  }

  if (latest.visualFailures > previous.visualFailures) {
    insights.push({
      id: "trend:visual-regression",
      severity: "medium",
      title: "Visual mismatches increased",
      recommendation: "Review diff artifacts and update baselines only for intentional UI changes."
    });
  }

  const flipCount = points.slice(1).reduce((sum, point, index) => {
    const prior = points[index]!;
    return sum + (prior.overallStatus !== point.overallStatus ? 1 : 0);
  }, 0);
  if (flipCount >= 2) {
    insights.push({
      id: "trend:flaky-gate",
      severity: "low",
      title: "Gate status has flipped multiple times",
      recommendation: "Investigate unstable tests/pages and reduce high-variance checks."
    });
  }

  return insights;
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

export function aggregateSteps(results: TargetAuditResult[]): Summary["steps"] {
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

export function buildPageEntry(result: TargetAuditResult): PageSummaryEntry {
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

export function buildRollup(pages: PageSummaryEntry[]): SummaryV2Rollup {
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
  const candidate = value as {
    schemaVersion?: unknown;
    startedAt?: unknown;
    overallStatus?: unknown;
    durationMs?: unknown;
    pages?: unknown[];
    rollup?: {
      pageCount?: unknown;
      failedPages?: unknown;
      a11yViolations?: unknown;
      performanceBudgetFailures?: unknown;
      visualFailures?: unknown;
    };
  };

  return (
    typeof candidate.schemaVersion === "string" &&
    candidate.schemaVersion.startsWith("2.") &&
    typeof candidate.startedAt === "string" &&
    isOverallStatus(candidate.overallStatus) &&
    isFiniteNumber(candidate.durationMs) &&
    Array.isArray(candidate.pages) &&
    candidate.pages.every((page) => isTrendPageSummaryCandidate(page)) &&
    Boolean(candidate.rollup) &&
    isFiniteNumber(candidate.rollup?.pageCount) &&
    isFiniteNumber(candidate.rollup?.failedPages) &&
    isFiniteNumber(candidate.rollup?.a11yViolations) &&
    isFiniteNumber(candidate.rollup?.performanceBudgetFailures) &&
    isFiniteNumber(candidate.rollup?.visualFailures)
  );
}

export async function loadLatestTrendSnapshot(
  historyDir: string,
  logger: WarningLogger
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

export async function loadTrendHistoryPoints(
  historyDir: string,
  logger: WarningLogger,
  window: number
): Promise<TrendHistoryPoint[]> {
  if (!(await pathExists(historyDir))) {
    return [];
  }

  const entries = await readdir(historyDir, { withFileTypes: true });
  const snapshotFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".summary.v2.json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .slice(-window);

  const points: TrendHistoryPoint[] = [];
  for (const fileName of snapshotFiles) {
    try {
      const absolutePath = path.join(historyDir, fileName);
      const raw = await readFile(absolutePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (isAuditSummaryV2(parsed)) {
        points.push(toHistoryPoint(parsed));
      } else {
        logger.warn(`Ignoring incompatible trend history snapshot: ${fileName}`);
      }
    } catch {
      logger.warn(`Ignoring unreadable trend history snapshot: ${fileName}`);
    }
  }

  return points;
}

export function buildTrendSummary(
  current: AuditSummaryV2,
  previous: LoadedTrendSnapshot,
  outDir: string,
  historyDir: string,
  enabled: boolean,
  historyPoints: TrendHistoryPoint[],
  dashboardWindow: number
): TrendDeltaSummary {
  const historyWithCurrent = [...historyPoints, toHistoryPoint(current)].slice(-dashboardWindow);
  const trendInsights = buildTrendInsights(historyWithCurrent);

  if (!enabled) {
    return {
      status: "disabled",
      historyDir: null,
      previousSnapshotPath: null,
      message: null,
      metrics: null,
      pages: [],
      history: null,
      insights: []
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
      pages: [],
      history: {
        window: dashboardWindow,
        points: historyWithCurrent
      },
      insights: trendInsights
    };
  }

  const previousSnapshot = previous.snapshot;
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
      performanceScore: toNullableTrendDelta(
        page.metrics.performanceScore,
        previousPage?.metrics.performanceScore ?? null
      ),
      maxMismatchRatio: toNullableTrendDelta(
        page.metrics.maxMismatchRatio,
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
    pages: pageDeltas,
    history: {
      window: dashboardWindow,
      points: historyWithCurrent
    },
    insights: trendInsights
  };
}

export async function writeTrendSnapshot(
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
    try {
      await unlink(path.join(historyDir, oldest));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
