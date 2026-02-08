import path from "node:path";
import { loadConfig } from "./config/loadConfig.js";
import { openPage, captureScreenshots } from "./runner/playwright.js";
import { runAxeScan } from "./runner/axe.js";
import { runLighthouseAudit } from "./runner/lighthouse.js";
import { runVisualDiff } from "./runner/visualDiff.js";
import { buildSummary } from "./report/summary.js";
import { buildHtmlReport } from "./report/html.js";
import { ensureDir, writeJson, writeText, validateOutputDirectory } from "./utils/fs.js";
import { createLogger } from "./utils/logger.js";
import { durationMs, nowIso } from "./utils/timing.js";
import type { AxeSummary } from "./runner/axe.js";
import type { LighthouseSummary } from "./runner/lighthouse.js";
import type { VisualDiffSummary } from "./runner/visualDiff.js";
import type { Summary } from "./report/summary.js";

export type { Summary } from "./report/summary.js";
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
}

function toRelative(outDir: string, filePath: string): string {
  const rel = path.relative(outDir, filePath);
  return rel.split(path.sep).join("/");
}

export async function runAudit(
  url: string,
  options: AuditOptions
): Promise<{ exitCode: number; summary: Summary }> {
  const configPath = path.resolve(process.cwd(), options.config);
  const outDir = path.resolve(process.cwd(), options.out);
  const baselineDir = path.resolve(process.cwd(), options.baselineDir);
  const screenshotsDir = path.join(outDir, "screenshots");
  const diffsDir = path.join(outDir, "diffs");

  validateOutputDirectory(outDir);
  validateOutputDirectory(baselineDir);

  const logger = createLogger(options.verbose);

  const config = await loadConfig(configPath);

  await ensureDir(outDir);
  await ensureDir(screenshotsDir);
  await ensureDir(diffsDir);

  const startedAt = nowIso();
  const startTime = Date.now();

  let axeSummary: AxeSummary | null = null;
  let lighthouseSummary: LighthouseSummary | null = null;
  let visualSummary: VisualDiffSummary | null = null;

  const { browser, page } = await openPage(url, config, logger);
  try {
    if (config.toggles.a11y) {
      axeSummary = await runAxeScan(page, outDir, logger);
    }

    const screenshots = await captureScreenshots(page, url, config, screenshotsDir, logger);

    if (config.toggles.perf) {
      lighthouseSummary = await runLighthouseAudit(url, outDir, config, logger);
    }

    if (config.toggles.visual) {
      visualSummary = await runVisualDiff(
        screenshots,
        baselineDir,
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

    const relativeA11y = axeSummary
      ? { ...axeSummary, reportPath: toRelative(outDir, axeSummary.reportPath) }
      : null;

    const relativePerf = lighthouseSummary
      ? { ...lighthouseSummary, reportPath: toRelative(outDir, lighthouseSummary.reportPath) }
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
      summary: "summary.json",
      report: "report.html",
      axe: relativeA11y?.reportPath ?? null,
      lighthouse: relativePerf?.reportPath ?? null,
      screenshotsDir: "screenshots",
      diffsDir: "diffs",
      baselineDir: toRelative(outDir, baselineDir)
    };

    const summary = buildSummary({
      url,
      startedAt,
      durationMs: durationMs(startTime),
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

    await writeJson(path.join(outDir, "summary.json"), summary);
    const html = buildHtmlReport(summary);
    await writeText(path.join(outDir, "report.html"), html);

    const exitCode = summary.overallStatus === "fail" ? 1 : 0;
    return { exitCode, summary };
  } finally {
    await browser.close();
  }
}
