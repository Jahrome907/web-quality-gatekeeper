import { Command } from "commander";
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

class UsageError extends Error {
  exitCode = 2;
}

// Security: Patterns that may indicate internal network access (SSRF risk)
const INTERNAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/, // Link-local / AWS metadata
  /^\[?::1\]?$/, // IPv6 localhost
  /^0\.0\.0\.0$/
];

function isInternalHost(hostname: string): boolean {
  return INTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function validateUrl(raw: string): { url: string; isInternal: boolean } {
  try {
    const url = new URL(raw);
    if (!url.protocol.startsWith("http")) {
      throw new Error("URL must start with http or https");
    }
    const isInternal = isInternalHost(url.hostname);
    return { url: url.toString(), isInternal };
  } catch {
    throw new UsageError(`Invalid URL: ${raw}`);
  }
}

function toRelative(outDir: string, filePath: string): string {
  const rel = path.relative(outDir, filePath);
  return rel.split(path.sep).join("/");
}

async function runAudit(
  rawUrl: string,
  options: {
    config: string;
    out: string;
    baselineDir: string;
    setBaseline: boolean;
    failOnA11y: boolean;
    failOnPerf: boolean;
    failOnVisual: boolean;
    verbose: boolean;
  }
): Promise<number> {
  const { url, isInternal } = validateUrl(rawUrl);
  const configPath = path.resolve(process.cwd(), options.config);
  const outDir = path.resolve(process.cwd(), options.out);
  const baselineDir = path.resolve(process.cwd(), options.baselineDir);
  const screenshotsDir = path.join(outDir, "screenshots");
  const diffsDir = path.join(outDir, "diffs");

  // Security: Validate output directories are within working directory
  try {
    validateOutputDirectory(outDir);
    validateOutputDirectory(baselineDir);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

  const logger = createLogger(options.verbose);

  // Security: Warn when auditing internal/private network addresses
  if (isInternal) {
    logger.warn(
      `Auditing internal network address (${new URL(url).hostname}). ` +
        `Ensure this is intentional. See SECURITY.md for SSRF guidance.`
    );
  }
  logger.info("Starting audit");

  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    throw new UsageError((error as Error).message);
  }

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

    logger.info(`Overall status: ${summary.overallStatus}`);
    return summary.overallStatus === "fail" ? 1 : 0;
  } finally {
    await browser.close();
  }
}

const program = new Command();
program.name("wqg").description("Web Quality Gatekeeper");

program
  .command("audit")
  .argument("<url>", "URL to audit")
  .option("--config <path>", "Config file path", "configs/default.json")
  .option("--out <dir>", "Output directory", "artifacts")
  .option("--baseline-dir <dir>", "Baseline directory", "baselines")
  .option("--set-baseline", "Overwrite baseline images", false)
  .option("--no-fail-on-a11y", "Do not fail on accessibility violations")
  .option("--no-fail-on-perf", "Do not fail on performance budget failures")
  .option("--no-fail-on-visual", "Do not fail on visual diffs")
  .option("--verbose", "Verbose logging", false)
  .action(async (url: string, options) => {
    try {
      const exitCode = await runAudit(url, {
        config: options.config,
        out: options.out,
        baselineDir: options.baselineDir,
        setBaseline: options.setBaseline ?? false,
        failOnA11y: options.failOnA11y ?? true,
        failOnPerf: options.failOnPerf ?? true,
        failOnVisual: options.failOnVisual ?? true,
        verbose: options.verbose ?? false
      });
      process.exitCode = exitCode;
    } catch (error) {
      const message = (error as Error).message || "Unexpected error";
      if (error instanceof UsageError) {
        console.error(message);
        process.exitCode = 2;
      } else {
        console.error(message);
        process.exitCode = 1;
      }
    }
  });

program.parseAsync(process.argv);
