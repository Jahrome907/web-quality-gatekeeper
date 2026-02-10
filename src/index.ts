import path from "node:path";
import { createRequire } from "node:module";
import { loadConfig } from "./config/loadConfig.js";
import { openPage, captureScreenshots } from "./runner/playwright.js";
import { runAxeScan } from "./runner/axe.js";
import { runLighthouseAudit } from "./runner/lighthouse.js";
import { runVisualDiff } from "./runner/visualDiff.js";
import * as summaryReport from "./report/summary.js";
import { buildHtmlReport } from "./report/html.js";
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
import type { Summary, SummaryV2 } from "./report/summary.js";
import {
  type AuditSummaryV2,
  type ResolvedAuditTarget,
  type TargetAuditResult,
  aggregateSteps,
  buildPageEntry,
  buildRollup,
  buildTrendSummary,
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
const SCHEMA_VERSION_V2_FALLBACK = "2.0.0";

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
    }
  };
  await writeText(path.join(outDir, "report.html"), buildHtmlReport(reportSummary));

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
