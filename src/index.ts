import path from "node:path";
import { createRequire } from "node:module";
import { loadConfig } from "./config/loadConfig.js";
import { openPage, captureScreenshots } from "./runner/playwright.js";
import { runAxeScan } from "./runner/axe.js";
import { runLighthouseAudit } from "./runner/lighthouse.js";
import { runVisualDiff, type VisualDiffRuntimeOptions } from "./runner/visualDiff.js";
import * as summaryReport from "./report/summary.js";
import { buildHtmlReport } from "./report/html.js";
import { buildInsights } from "./report/insights.js";
import { buildActionPlanMarkdown } from "./report/actionPlan.js";
import { buildTrendDashboardHtml } from "./report/trendDashboard.js";
import {
  ensureDir,
  validateOutputDirectory,
  writeJson,
  writeText
} from "./utils/fs.js";
import { createLogger } from "./utils/logger.js";
import { durationMs, nowIso } from "./utils/timing.js";
import type { Config } from "./config/schema.js";
import type { AxeSummary } from "./runner/axe.js";
import type { LighthouseSummary } from "./runner/lighthouse.js";
import type { VisualDiffSummary } from "./runner/visualDiff.js";
import type { RuntimeSignalSummary } from "./runner/playwright.js";
import type { AuditAuth } from "./utils/auth.js";
import type { TargetResolutionPolicy } from "./utils/url.js";
import type { Summary, SummaryV2 } from "./report/summary.js";
import {
  type AuditSummaryV2,
  type ResolvedAuditTarget,
  type TargetAuditResult,
  aggregateSteps,
  buildPageEntry,
  buildRollup,
  buildTrendSummary,
  loadTrendHistoryPoints,
  loadLatestTrendSnapshot,
  resolveTargets,
  resolveTrendSettings,
  toRelative,
  writeTrendSnapshot
} from "./audit/orchestration.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// TODO: Remove fallback URIs once all consumers provide SCHEMA_VERSION*,
// SUMMARY_SCHEMA_URI*, and buildSummaryV2 via report/summary.
const SUMMARY_SCHEMA_URI_V1_FALLBACK =
  "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json";
const SUMMARY_SCHEMA_URI_V2_FALLBACK =
  "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json";
const SCHEMA_VERSION_V1_FALLBACK = "1.1.0";
const SCHEMA_VERSION_V2_FALLBACK = "2.2.0";

type OverallStatus = "pass" | "fail";

export type { Summary, SummaryV2 } from "./report/summary.js";
export { SCHEMA_VERSION } from "./report/summary.js";
export type { Config } from "./config/schema.js";
export type {
  TrendNumericDelta,
  TrendPageDelta,
  TrendDeltaSummary,
  SummaryV2Rollup,
  PageSummaryEntry,
  AuditSummaryV2
} from "./audit/orchestration.js";

export interface AuditOptions {
  config: string;
  policy?: string | null;
  out: string;
  baselineDir: string;
  setBaseline: boolean;
  allowInternalTargets?: boolean;
  failOnA11y: boolean;
  failOnPerf: boolean;
  failOnVisual: boolean;
  verbose: boolean;
  format?: string;
  auth?: AuditAuth | null;
}

function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = `${env.CI ?? env.GITHUB_ACTIONS ?? ""}`.toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function severityWeight(value: string): number {
  switch (value) {
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

function aggregateRunInsights(results: TargetAuditResult[]): SummaryV2["insights"] {
  const combined = results.flatMap((result) => result.summaryV2.insights?.recommendations ?? []);
  if (combined.length === 0) {
    return null;
  }

  const deduped = new Map<string, (typeof combined)[number]>();
  combined.forEach((item) => {
    deduped.set(item.id, item);
  });

  const recommendations = Array.from(deduped.values())
    .sort((left, right) => {
      const severity = severityWeight(right.severity) - severityWeight(left.severity);
      if (severity !== 0) {
        return severity;
      }
      return left.id.localeCompare(right.id);
    })
    .slice(0, 10);

  return {
    recommendations
  };
}

async function runTargetAudit(params: {
  target: ResolvedAuditTarget;
  outDir: string;
  config: Config;
  options: AuditOptions;
  targetPolicy: TargetResolutionPolicy;
  logger: ReturnType<typeof createLogger>;
}): Promise<TargetAuditResult> {
  const { target, config, options, targetPolicy, logger, outDir } = params;

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

  const {
    browser,
    page,
    runtimeSignals,
    resolvedUrl,
    resolvedHostResolverRules
  } = await openPage(
    target.url,
    config,
    logger,
    options.auth ?? null,
    {
      hostResolverRules: target.hostResolverRules,
      targetPolicy
    }
  );
  try {
    if (config.toggles.a11y) {
      axeSummary = await runAxeScan(page, target.outDir, logger, config);
    }

    const screenshots = await captureScreenshots(page, resolvedUrl, config, screenshotsDir, logger);

    if (config.toggles.perf) {
      lighthouseSummary = await runLighthouseAudit(
        resolvedUrl,
        target.outDir,
        config,
        logger,
        options.auth ?? null,
        {
          hostResolverRules: resolvedHostResolverRules ?? target.hostResolverRules,
          targetPolicy
        }
      );
    }

    if (config.toggles.visual) {
      const visualDiffOptions: VisualDiffRuntimeOptions = {
        ...(config.visual.pixelmatch ? { pixelmatch: config.visual.pixelmatch } : {}),
        ...(config.visual.ignoreRegions ? { ignoreRegions: config.visual.ignoreRegions } : {})
      };
      visualSummary = await runVisualDiff(
        screenshots,
        target.baselineDir,
        diffsDir,
        options.setBaseline,
        config.visual.threshold,
        logger,
        visualDiffOptions
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

    const summaryV2Base = summaryReport.buildSummaryV2
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

    const summaryV2: SummaryV2 =
      config.insights?.enabled === false
        ? summaryV2Base
        : {
            ...summaryV2Base,
            insights: buildInsights(summaryV2Base)
          };

    await writeJson(summaryPath, summary);
    await writeJson(summaryV2Path, summaryV2);
    await writeText(reportPath, buildHtmlReport(summaryV2));

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
  const config = await loadConfig(configPath, {
    policy: options.policy ?? null
  });
  const targetPolicy: TargetResolutionPolicy = {
    allowInternalTargets: options.allowInternalTargets ?? false,
    blockInternalTargets: isCiEnvironment() || Boolean(options.auth)
  };
  const targets = await resolveTargets(url, config, outDir, baselineDir, logger, targetPolicy);

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
      targetPolicy,
      logger
    });
    results.push(result);
  }

  const overallStatus: OverallStatus = results.some((result) => result.summary.overallStatus === "fail")
    ? "fail"
    : "pass";
  const runInsights = aggregateRunInsights(results);

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

  // Render report.html from the richer v2 payload so detailed Lighthouse/runtime
  // sections (including extended vitals) are available in the UI.
  const reportSummary: SummaryV2 = {
    ...results[0]!.summaryV2,
    overallStatus,
    durationMs: compatibilitySummary.durationMs,
    steps: compatibilitySummary.steps,
    artifacts: {
      ...results[0]!.summaryV2.artifacts,
      summary: "summary.json",
      summaryV2: "summary.v2.json",
      report: "report.html"
    },
    insights: runInsights ?? results[0]!.summaryV2.insights ?? null
  };
  await writeText(path.join(outDir, "report.html"), buildHtmlReport(reportSummary));

  const pages = results.map((result) => buildPageEntry(result));
  const rollup = buildRollup(pages);

  const trendSettings = resolveTrendSettings(config);
  const trendHistoryDir = path.isAbsolute(trendSettings.historyDir)
    ? trendSettings.historyDir
    : path.resolve(outDir, trendSettings.historyDir);
  const trendHistoryJsonPath = path.join(outDir, "trends", "history.json");
  const trendDashboardHtmlPath = path.join(outDir, "trends", "dashboard.html");
  const actionPlanPath = path.join(outDir, "action-plan.md");

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
    artifacts: {
      summary: "summary.json",
      summaryV2: "summary.v2.json",
      report: "report.html",
      trendDashboardHtml: null,
      trendHistoryJson: null,
      actionPlanMd: "action-plan.md"
    },
    rollup,
    pages,
    insights: runInsights,
    trend: {
      status: "disabled",
      historyDir: null,
      previousSnapshotPath: null,
      message: null,
      metrics: null,
      pages: [],
      history: null,
      insights: []
    }
  };

  if (trendSettings.enabled) {
    const historyPoints = await loadTrendHistoryPoints(
      trendHistoryDir,
      logger,
      trendSettings.dashboardWindow
    );
    const previous = await loadLatestTrendSnapshot(trendHistoryDir, logger);
    summaryV2.trend = buildTrendSummary(
      summaryV2,
      previous,
      outDir,
      trendHistoryDir,
      true,
      historyPoints,
      trendSettings.dashboardWindow
    );
    summaryV2.artifacts.trendHistoryJson = toRelative(outDir, trendHistoryJsonPath);
    summaryV2.artifacts.trendDashboardHtml = toRelative(outDir, trendDashboardHtmlPath);
  }

  await writeJson(path.join(outDir, "summary.v2.json"), summaryV2);
  await writeText(actionPlanPath, buildActionPlanMarkdown(summaryV2.insights ?? null));

  if (trendSettings.enabled) {
    await writeJson(trendHistoryJsonPath, summaryV2.trend.history);
    await writeText(trendDashboardHtmlPath, buildTrendDashboardHtml(summaryV2.trend));
    await writeTrendSnapshot(trendHistoryDir, summaryV2, trendSettings.maxSnapshots);
  }

  const exitCode = overallStatus === "fail" ? 1 : 0;
  return { exitCode, summary: compatibilitySummary, summaryV2 };
}
