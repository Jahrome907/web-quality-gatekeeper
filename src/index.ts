import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { loadConfig } from "./config/loadConfig.js";
import { captureScreenshots, runPlaywrightLifecycle } from "./runner/playwright.js";
import { runAxeScan } from "./runner/axe.js";
import { runLighthouseAudit } from "./runner/lighthouse.js";
import { runVisualDiff, type VisualDiffRuntimeOptions } from "./runner/visualDiff.js";
import * as summaryReport from "./report/summary.js";
import { buildHtmlReport } from "./report/html.js";
import { buildInsights } from "./report/insights.js";
import { buildActionPlanMarkdown } from "./report/actionPlan.js";
import {
  PR_RISK_LEDGER_ARTIFACT_NAMES,
  buildPrRiskLedger,
  formatPrRiskLedgerAsMarkdown
} from "./report/prRiskLedger.js";
import { buildTrendDashboardHtml } from "./report/trendDashboard.js";
import type { AggregateHtmlReport } from "./report/viewModel.js";
import {
  copyFileSafe,
  ensureDir,
  validateOutputDirectory,
  validateResolvedPathWithinBase,
  writeJson,
  writeText
} from "./utils/fs.js";
import { prepareOutputBundle, validatePreservedOutputDirectory } from "./audit/outputBundle.js";
import { createLogger } from "./utils/logger.js";
import { durationMs, nowIso } from "./utils/timing.js";
import type { Config } from "./config/schema.js";
import type { AxeSummary } from "./runner/axe.js";
import type { LighthouseSummary } from "./runner/lighthouse.js";
import type { VisualDiffSummary } from "./runner/visualDiff.js";
import type { RuntimeSignalSummary, ScreenshotResult } from "./runner/playwright.js";
import type { AuditAuth } from "./utils/auth.js";
import type { TargetResolutionPolicy } from "./utils/url.js";
import type { Summary, SummaryV2 as DetailSummaryV2 } from "./report/summary.js";
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

type OverallStatus = "pass" | "fail";

export type { Summary, SummaryV2, SummaryV2 as DetailSummaryV2 } from "./report/summary.js";
export { SCHEMA_VERSION } from "./report/summary.js";
export {
  PR_RISK_LEDGER_ARTIFACT_NAMES,
  buildPrRiskLedger,
  formatPrRiskLedgerAsMarkdown
} from "./report/prRiskLedger.js";
export type { PrRiskLedger, PrRiskLedgerEntry } from "./report/prRiskLedger.js";
export { scaffoldConsumerProject } from "./init/scaffold.js";
export type { InitProfileName, InitScaffoldOptions, InitScaffoldResult } from "./init/scaffold.js";
export type { Config } from "./config/schema.js";
export type { AggregateHtmlReport, HtmlReportSource, ReportViewModel } from "./report/viewModel.js";
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
  return isTruthy(env.CI) || isTruthy(env.GITHUB_ACTIONS);
}

function isTruthy(value: string | undefined): boolean {
  const normalized = `${value ?? ""}`.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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

function aggregateRunInsights(results: TargetAuditResult[]): DetailSummaryV2["insights"] {
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

function buildCompatibilitySummary(params: {
  results: TargetAuditResult[];
  overallStatus: OverallStatus;
  durationMs: number;
}): Summary {
  const { results, overallStatus, durationMs } = params;
  const first = results[0]!.summary;
  return {
    ...first,
    overallStatus,
    durationMs,
    steps: aggregateSteps(results),
    artifacts: {
      ...first.artifacts,
      summary: summaryReport.SUMMARY_ARTIFACT_NAMES.summary,
      report: summaryReport.SUMMARY_ARTIFACT_NAMES.report
    }
  };
}

async function promoteAttemptArtifact(
  sourcePath: string,
  attemptDir: string,
  destinationDir: string
): Promise<string> {
  validateResolvedPathWithinBase(sourcePath, attemptDir);
  const relativePath = path.relative(attemptDir, sourcePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Playwright attempt artifact escapes its staging directory: ${sourcePath}`);
  }
  const destinationPath = path.join(destinationDir, relativePath);
  validateResolvedPathWithinBase(destinationPath, destinationDir);
  await copyFileSafe(sourcePath, destinationPath);
  return destinationPath;
}

function toPublishedArtifactPath(
  stagingOutDir: string,
  publishedOutDir: string,
  filePath: string
): string {
  validateResolvedPathWithinBase(filePath, stagingOutDir);
  const relativePath = path.relative(stagingOutDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Staged artifact escapes its output directory: ${filePath}`);
  }
  return path.join(publishedOutDir, relativePath);
}

async function runTargetAudit(params: {
  target: ResolvedAuditTarget;
  publishedTarget: ResolvedAuditTarget;
  outDir: string;
  publishedOutDir: string;
  config: Config;
  options: AuditOptions;
  targetPolicy: TargetResolutionPolicy;
  logger: ReturnType<typeof createLogger>;
}): Promise<TargetAuditResult> {
  const {
    target,
    publishedTarget,
    config,
    options,
    targetPolicy,
    logger,
    outDir,
    publishedOutDir
  } = params;

  const screenshotsDir = path.join(target.outDir, "screenshots");
  const diffsDir = path.join(target.outDir, "diffs");
  const summaryPath = path.join(target.outDir, summaryReport.SUMMARY_ARTIFACT_NAMES.summary);
  const summaryV2Path = path.join(target.outDir, summaryReport.SUMMARY_ARTIFACT_NAMES.summaryV2);
  const reportPath = path.join(target.outDir, summaryReport.SUMMARY_ARTIFACT_NAMES.report);

  validateOutputDirectory(target.outDir);
  validateOutputDirectory(target.baselineDir);
  validateOutputDirectory(screenshotsDir);
  validateOutputDirectory(diffsDir);
  await ensureDir(target.outDir);
  await ensureDir(screenshotsDir);
  await ensureDir(diffsDir);

  const startedAt = nowIso();
  const startTime = Date.now();

  let axeSummary: AxeSummary | null;
  let lighthouseSummary: LighthouseSummary | null = null;
  let visualSummary: VisualDiffSummary | null = null;

  let attemptDir: string | null = null;
  let attemptScreenshotsDir: string | null = null;
  let browserAudit: {
    axeSummary: AxeSummary | null;
    screenshots: ScreenshotResult[];
    runtimeSignals: RuntimeSignalSummary;
    resolvedUrl: string;
    resolvedHostResolverRules: string | null;
  };
  try {
    browserAudit = await runPlaywrightLifecycle(
      target.url,
      config,
      logger,
      options.auth ?? null,
      {
        hostResolverRules: target.hostResolverRules,
        targetPolicy
      },
      async ({ page, runtimeSignals, resolvedUrl, resolvedHostResolverRules }) => {
        if (attemptDir) {
          await rm(attemptDir, { recursive: true, force: true });
        }
        attemptDir = await mkdtemp(path.join(target.outDir, ".wqg-playwright-attempt-"));
        validateResolvedPathWithinBase(attemptDir, target.outDir);
        attemptScreenshotsDir = path.join(attemptDir, "screenshots");
        validateResolvedPathWithinBase(attemptScreenshotsDir, attemptDir);
        const axeSummary = config.toggles.a11y
          ? await runAxeScan(page, attemptDir, logger, config)
          : null;
        const screenshots = await captureScreenshots(
          page,
          resolvedUrl,
          config,
          attemptScreenshotsDir,
          logger
        );
        return {
          axeSummary,
          screenshots,
          runtimeSignals: runtimeSignals.snapshot(),
          resolvedUrl,
          resolvedHostResolverRules
        };
      }
    );
    axeSummary = browserAudit.axeSummary
      ? {
          ...browserAudit.axeSummary,
          reportPath: await promoteAttemptArtifact(
            browserAudit.axeSummary.reportPath,
            attemptDir!,
            target.outDir
          )
        }
      : null;
    browserAudit.screenshots = await Promise.all(
      browserAudit.screenshots.map(async (screenshot) => ({
        ...screenshot,
        path: await promoteAttemptArtifact(screenshot.path, attemptScreenshotsDir!, screenshotsDir)
      }))
    );
  } finally {
    if (attemptDir) {
      await rm(attemptDir, { recursive: true, force: true });
    }
  }
  const { screenshots, runtimeSignals, resolvedUrl, resolvedHostResolverRules } = browserAudit;
  const auditedUrl = resolvedUrl;

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
      ...(config.visual.engine ? { engine: config.visual.engine } : {}),
      ...(config.visual.nativeBinaryPath
        ? { nativeBinaryPath: config.visual.nativeBinaryPath }
        : {}),
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
    path: toRelative(publishedOutDir, toPublishedArtifactPath(outDir, publishedOutDir, shot.path))
  }));

  const relativeA11yV2 = axeSummary
    ? {
        ...axeSummary,
        reportPath: toRelative(
          publishedOutDir,
          toPublishedArtifactPath(outDir, publishedOutDir, axeSummary.reportPath)
        )
      }
    : null;
  const relativeA11y = relativeA11yV2
    ? {
        violations: relativeA11yV2.violations,
        countsByImpact: relativeA11yV2.countsByImpact,
        reportPath: relativeA11yV2.reportPath
      }
    : null;

  const relativePerfV2 = lighthouseSummary
    ? {
        ...lighthouseSummary,
        reportPath: toRelative(
          publishedOutDir,
          toPublishedArtifactPath(outDir, publishedOutDir, lighthouseSummary.reportPath)
        )
      }
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
          currentPath: toRelative(
            publishedOutDir,
            toPublishedArtifactPath(outDir, publishedOutDir, result.currentPath)
          ),
          baselinePath: toRelative(publishedOutDir, result.baselinePath),
          diffPath: result.diffPath
            ? toRelative(
                publishedOutDir,
                toPublishedArtifactPath(outDir, publishedOutDir, result.diffPath)
              )
            : null
        }))
      }
    : null;

  const artifacts = {
    summary: toRelative(
      publishedOutDir,
      toPublishedArtifactPath(outDir, publishedOutDir, summaryPath)
    ),
    report: toRelative(
      publishedOutDir,
      toPublishedArtifactPath(outDir, publishedOutDir, reportPath)
    ),
    axe: relativeA11y?.reportPath ?? null,
    lighthouse: relativePerf?.reportPath ?? null,
    screenshotsDir: toRelative(
      publishedOutDir,
      toPublishedArtifactPath(outDir, publishedOutDir, screenshotsDir)
    ),
    diffsDir: toRelative(
      publishedOutDir,
      toPublishedArtifactPath(outDir, publishedOutDir, diffsDir)
    ),
    baselineDir: toRelative(publishedOutDir, target.baselineDir)
  };

  const runDurationMs = durationMs(startTime);
  const summary = summaryReport.buildSummary({
    url: auditedUrl,
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

  const summaryV2Base = summaryReport.buildSummaryV2({
    url: auditedUrl,
    startedAt,
    durationMs: runDurationMs,
    toolVersion: pkg.version,
    screenshots: relativeScreenshots,
    a11y: relativeA11yV2,
    performance: relativePerfV2,
    visual: relativeVisual,
    runtimeSignals,
    artifacts: {
      ...artifacts,
      summaryV2: toRelative(
        publishedOutDir,
        toPublishedArtifactPath(outDir, publishedOutDir, summaryV2Path)
      )
    },
    options: {
      failOnA11y: options.failOnA11y,
      failOnPerf: options.failOnPerf,
      failOnVisual: options.failOnVisual
    }
  });

  const summaryV2: DetailSummaryV2 =
    config.insights?.enabled === false
      ? summaryV2Base
      : {
          ...summaryV2Base,
          insights: buildInsights(summaryV2Base)
        };

  await writeJson(summaryPath, summary);
  await writeJson(summaryV2Path, summaryV2);
  await writeText(
    reportPath,
    buildHtmlReport(summaryV2, {
      reportPath: toRelative(
        publishedOutDir,
        toPublishedArtifactPath(outDir, publishedOutDir, reportPath)
      )
    })
  );

  return {
    target: publishedTarget,
    summary,
    summaryV2
  };
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

  for (const target of targets) {
    validateOutputDirectory(target.outDir);
    validateOutputDirectory(target.baselineDir);
  }
  const trendSettings = resolveTrendSettings(config);
  const trendHistoryDir = path.isAbsolute(trendSettings.historyDir)
    ? trendSettings.historyDir
    : path.resolve(outDir, trendSettings.historyDir);

  validatePreservedOutputDirectory(outDir, baselineDir, "Baseline directory");
  if (trendSettings.enabled) {
    validateOutputDirectory(trendHistoryDir);
    validatePreservedOutputDirectory(outDir, trendHistoryDir, "Trend history directory");
  }

  const bundle = await prepareOutputBundle(outDir);
  const stagedOutDir = bundle.stagingDir;

  try {
    const stagedTargets = targets.map((target) => {
      const relativePath = path.relative(outDir, target.outDir);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(
          `Audit target output escapes the requested output directory: ${target.outDir}`
        );
      }
      return {
        ...target,
        outDir: path.join(stagedOutDir, relativePath)
      };
    });
    const startedAt = nowIso();
    const startTime = Date.now();
    const results: TargetAuditResult[] = [];

    for (let index = 0; index < stagedTargets.length; index += 1) {
      const target = stagedTargets[index]!;
      const publishedTarget = targets[index]!;
      logger.debug(
        `Running audit target ${target.index + 1}/${targets.length}: ${target.name} (${target.url})`
      );
      const result = await runTargetAudit({
        target,
        publishedTarget,
        outDir: stagedOutDir,
        publishedOutDir: outDir,
        config,
        options,
        targetPolicy,
        logger
      });
      results.push(result);
    }

    const overallStatus: OverallStatus = results.some(
      (result) => result.summary.overallStatus === "fail"
    )
      ? "fail"
      : "pass";
    const runInsights = aggregateRunInsights(results);
    const pages = results.map((result) => buildPageEntry(result));
    const rollup = buildRollup(pages);

    const compatibilitySummary = buildCompatibilitySummary({
      results,
      overallStatus,
      durationMs: durationMs(startTime)
    });

    await writeJson(
      path.join(stagedOutDir, summaryReport.SUMMARY_ARTIFACT_NAMES.summary),
      compatibilitySummary
    );

    const trendHistoryJsonPath = path.join(stagedOutDir, "trends", "history.json");
    const trendDashboardHtmlPath = path.join(stagedOutDir, "trends", "dashboard.html");
    const actionPlanPath = path.join(stagedOutDir, summaryReport.SUMMARY_ARTIFACT_NAMES.actionPlan);

    if (trendSettings.enabled) {
      validateOutputDirectory(trendHistoryJsonPath);
      validateOutputDirectory(trendDashboardHtmlPath);
    }

    const summaryV2: AuditSummaryV2 = {
      $schema: summaryReport.SUMMARY_SCHEMA_POINTERS.v2,
      schemaVersion: summaryReport.SUMMARY_SCHEMA_VERSIONS.v2,
      toolVersion: pkg.version,
      mode: pages.length > 1 ? "multi" : "single",
      overallStatus,
      startedAt,
      durationMs: compatibilitySummary.durationMs,
      primaryUrl: pages[0]!.url,
      schemaPointers: summaryReport.SUMMARY_SCHEMA_POINTERS,
      schemaVersions: summaryReport.SUMMARY_SCHEMA_VERSIONS,
      compatibility: {
        v1SummaryPath: summaryReport.SUMMARY_ARTIFACT_NAMES.summary,
        v1Schema: summaryReport.SUMMARY_SCHEMA_POINTERS.v1,
        v1SchemaVersion: summaryReport.SUMMARY_SCHEMA_VERSIONS.v1,
        note: summaryReport.SUMMARY_V2_COMPATIBILITY_NOTE
      },
      artifacts: {
        summary: summaryReport.SUMMARY_ARTIFACT_NAMES.summary,
        summaryV2: summaryReport.SUMMARY_ARTIFACT_NAMES.summaryV2,
        report: summaryReport.SUMMARY_ARTIFACT_NAMES.report,
        prRiskLedgerJson: PR_RISK_LEDGER_ARTIFACT_NAMES.json,
        prRiskLedgerMd: PR_RISK_LEDGER_ARTIFACT_NAMES.markdown,
        trendDashboardHtml: null,
        trendHistoryJson: null,
        actionPlanMd: summaryReport.SUMMARY_ARTIFACT_NAMES.actionPlan
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
      summaryV2.artifacts.trendHistoryJson = toRelative(stagedOutDir, trendHistoryJsonPath);
      summaryV2.artifacts.trendDashboardHtml = toRelative(stagedOutDir, trendDashboardHtmlPath);
    }

    await writeJson(
      path.join(stagedOutDir, summaryReport.SUMMARY_ARTIFACT_NAMES.summaryV2),
      summaryV2
    );
    const prRiskLedger = buildPrRiskLedger(summaryV2);
    await writeJson(path.join(stagedOutDir, PR_RISK_LEDGER_ARTIFACT_NAMES.json), prRiskLedger);
    await writeText(
      path.join(stagedOutDir, PR_RISK_LEDGER_ARTIFACT_NAMES.markdown),
      formatPrRiskLedgerAsMarkdown(prRiskLedger)
    );
    const reportSource: AggregateHtmlReport = {
      kind: "aggregate",
      summary: summaryV2,
      steps: compatibilitySummary.steps
    };

    await writeText(
      path.join(stagedOutDir, summaryReport.SUMMARY_ARTIFACT_NAMES.report),
      buildHtmlReport(reportSource)
    );
    await writeText(
      actionPlanPath,
      buildActionPlanMarkdown(summaryV2.insights ?? null, summaryV2.trend.insights)
    );

    if (trendSettings.enabled) {
      await writeJson(trendHistoryJsonPath, summaryV2.trend.history);
      await writeText(trendDashboardHtmlPath, buildTrendDashboardHtml(summaryV2.trend));
    }

    await bundle.complete(async () => {
      if (trendSettings.enabled) {
        await writeTrendSnapshot(trendHistoryDir, summaryV2, trendSettings.maxSnapshots);
      }
    });

    const exitCode = overallStatus === "fail" ? 1 : 0;
    return { exitCode, summary: compatibilitySummary, summaryV2 };
  } catch (error) {
    await bundle.abort().catch(() => undefined);
    throw error;
  }
}
