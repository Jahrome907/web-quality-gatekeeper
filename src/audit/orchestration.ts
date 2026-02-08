import path from "node:path";
import { readdir, readFile, unlink } from "node:fs/promises";
import type { Config, TrendSettings, UrlTarget } from "../config/schema.js";
import { ensureDir, pathExists, writeJson } from "../utils/fs.js";
import { validateUrl, UsageError } from "../utils/url.js";
import type { StepStatus, Summary, SummaryV2 } from "../report/summary.js";

const DEFAULT_TREND_HISTORY_DIR = ".wqg-history";
const DEFAULT_TREND_MAX_SNAPSHOTS = 90;

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
}

export interface TargetAuditResult {
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

export interface LoadedTrendSnapshot {
  snapshot: AuditSummaryV2 | null;
  path: string | null;
  hadCorruptSnapshot: boolean;
  hadIncompatibleSnapshot: boolean;
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

export function resolveTrendSettings(config: Config): Required<TrendSettings> {
  return {
    enabled: config.trends?.enabled ?? false,
    historyDir: config.trends?.historyDir ?? DEFAULT_TREND_HISTORY_DIR,
    maxSnapshots: config.trends?.maxSnapshots ?? DEFAULT_TREND_MAX_SNAPSHOTS
  };
}

function normalizeTarget(raw: string, logger: WarningLogger): string {
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

export function resolveTargets(
  inputUrl: string | undefined,
  config: Config,
  outDir: string,
  baselineDir: string,
  logger: WarningLogger
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
  const candidate = value as Partial<AuditSummaryV2>;
  return (
    typeof candidate.schemaVersion === "string" &&
    candidate.schemaVersion.startsWith("2.") &&
    Array.isArray(candidate.pages) &&
    Boolean(candidate.rollup && typeof candidate.rollup.pageCount === "number")
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

export function buildTrendSummary(
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
    await unlink(path.join(historyDir, oldest));
  }
}
