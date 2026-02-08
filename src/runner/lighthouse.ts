import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import path from "node:path";
import type { Config } from "../config/schema.js";
import { writeJson } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";

export interface LighthouseBudgets {
  performance: number;
  lcpMs: number;
  cls: number;
  tbtMs: number;
}

export interface LighthouseMetrics {
  performanceScore: number;
  lcpMs: number;
  cls: number;
  tbtMs: number;
}

export interface LighthouseBudgetResults {
  performance: boolean;
  lcp: boolean;
  cls: boolean;
  tbt: boolean;
}

export interface LighthouseSummary {
  metrics: LighthouseMetrics;
  budgets: LighthouseBudgets;
  budgetResults: LighthouseBudgetResults;
  reportPath: string;
}

export function evaluateBudgets(
  metrics: LighthouseMetrics,
  budgets: LighthouseBudgets
): LighthouseBudgetResults {
  return {
    performance: metrics.performanceScore >= budgets.performance,
    lcp: metrics.lcpMs <= budgets.lcpMs,
    cls: metrics.cls <= budgets.cls,
    tbt: metrics.tbtMs <= budgets.tbtMs
  };
}

export function toFixedScore(score: number | null | undefined): number {
  if (typeof score !== "number") {
    return 0;
  }
  return Number(score.toFixed(2));
}

// Security: Determine if we can use sandbox (not in CI containers typically)
function getChromeFlags(): string[] {
  const flags = ["--headless", "--disable-gpu"];
  
  // In CI environments (containers), sandbox often doesn't work
  // Only disable sandbox when necessary
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  if (isCI) {
    flags.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  
  return flags;
}

export async function runLighthouseAudit(
  url: string,
  outDir: string,
  config: Config,
  logger: Logger
): Promise<LighthouseSummary> {
  logger.debug("Running Lighthouse audit");
  const chrome = await launch({
    chromeFlags: getChromeFlags()
  });

  try {
    const isMobile = config.lighthouse.formFactor === "mobile";
    const screenEmulation = isMobile
      ? {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 2
        }
      : {
          mobile: false,
          width: 1350,
          height: 940,
          deviceScaleFactor: 1
        };

    const runnerResult = await retry(
      () =>
        lighthouse(
          url,
          {
            port: chrome.port,
            output: "json",
            logLevel: "error",
            onlyCategories: ["performance"]
          },
          {
            extends: "lighthouse:default",
            settings: {
              formFactor: config.lighthouse.formFactor,
              screenEmulation
            }
          }
        ),
      { retries: 1, delayMs: 2000, logger }
    );

    if (!runnerResult?.lhr) {
      throw new Error("Lighthouse did not return a result");
    }

    const lhr = runnerResult.lhr;
    const lcpAudit = lhr.audits["largest-contentful-paint"];
    const clsAudit = lhr.audits["cumulative-layout-shift"];
    const tbtAudit = lhr.audits["total-blocking-time"];

    const metrics: LighthouseMetrics = {
      performanceScore: toFixedScore(lhr.categories.performance?.score ?? 0),
      lcpMs: typeof lcpAudit?.numericValue === "number" ? lcpAudit.numericValue : 0,
      cls: typeof clsAudit?.numericValue === "number" ? clsAudit.numericValue : 0,
      tbtMs: typeof tbtAudit?.numericValue === "number" ? tbtAudit.numericValue : 0
    };

    const budgets = config.lighthouse.budgets;
    const budgetResults = evaluateBudgets(metrics, budgets);

    const reportPath = path.join(outDir, "lighthouse.json");
    await writeJson(reportPath, lhr);

    return {
      metrics,
      budgets,
      budgetResults,
      reportPath
    };
  } finally {
    await chrome.kill();
  }
}
