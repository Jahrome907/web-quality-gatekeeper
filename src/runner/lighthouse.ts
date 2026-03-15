import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Config } from "../config/schema.js";
import { writeJson } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import type { AuditAuth } from "../utils/auth.js";
import { toCookieHeader } from "../utils/auth.js";
import {
  loadLighthousePuppeteer,
  type PuppeteerBrowserLike,
  type PuppeteerPageLike
} from "./lighthousePuppeteer.js";
import {
  isAuditableHttpUrl,
  normalizeUrlHostname,
  resolveAuditedTarget,
  UsageError,
  type TargetResolutionPolicy
} from "../utils/url.js";

const requireSync = createRequire(import.meta.url);

const MAX_OPPORTUNITIES = 10;

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

export interface LighthouseExtendedMetrics {
  fcpMs: number;
  speedIndexMs: number;
  ttiMs: number;
  ttfbMs: number;
}

export interface LighthouseCategoryScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface LighthouseOpportunity {
  id: string;
  title: string;
  score: number;
  displayValue: string;
  estimatedSavingsMs: number | null;
  estimatedSavingsBytes: number | null;
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
  categoryScores?: LighthouseCategoryScores;
  extendedMetrics?: LighthouseExtendedMetrics;
  opportunities?: LighthouseOpportunity[];
}

interface LighthouseAuditLike {
  id: string;
  title?: string;
  score?: number | null;
  numericValue?: number;
  displayValue?: string;
  details?: {
    overallSavingsMs?: number;
    overallSavingsBytes?: number;
  };
}

interface LighthouseLhrLike {
  categories?: Record<string, { score?: number | null }>;
  audits: Record<string, LighthouseAuditLike | undefined>;
  finalDisplayedUrl?: string;
  finalUrl?: string;
}

export interface LighthouseRunOptions {
  hostResolverRules?: string | null;
  targetPolicy?: TargetResolutionPolicy;
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

function toNumericValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toNullableNumeric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toError(error: unknown, fallbackMessage: string): Error {
  return error instanceof Error ? error : new Error(fallbackMessage);
}

function categoryScore(lhr: LighthouseLhrLike, key: string): number {
  return toFixedScore(lhr.categories?.[key]?.score ?? 0);
}

function extractExtendedMetrics(lhr: LighthouseLhrLike): LighthouseExtendedMetrics {
  const fcp = lhr.audits["first-contentful-paint"];
  const speedIndex = lhr.audits["speed-index"];
  const tti = lhr.audits["interactive"];
  const ttfb = lhr.audits["server-response-time"];

  return {
    fcpMs: toNumericValue(fcp?.numericValue),
    speedIndexMs: toNumericValue(speedIndex?.numericValue),
    ttiMs: toNumericValue(tti?.numericValue),
    ttfbMs: toNumericValue(ttfb?.numericValue)
  };
}

function extractOpportunities(lhr: LighthouseLhrLike): LighthouseOpportunity[] {
  function combinedSavings(opportunity: LighthouseOpportunity): number {
    return (opportunity.estimatedSavingsMs ?? 0) + (opportunity.estimatedSavingsBytes ?? 0);
  }

  const ranked = Object.values(lhr.audits)
    .filter((audit): audit is LighthouseAuditLike => Boolean(audit))
    .map((audit) => ({
      id: audit.id,
      title: audit.title ?? audit.id,
      score: toFixedScore(audit.score ?? 0),
      displayValue: audit.displayValue ?? "",
      estimatedSavingsMs: toNullableNumeric(audit.details?.overallSavingsMs),
      estimatedSavingsBytes: toNullableNumeric(audit.details?.overallSavingsBytes)
    }))
    .filter((audit) => {
      return (
        (audit.estimatedSavingsMs !== null && audit.estimatedSavingsMs > 0) ||
        (audit.estimatedSavingsBytes !== null && audit.estimatedSavingsBytes > 0)
      );
    })
    .sort((left, right) => {
      const savingsDelta = combinedSavings(right) - combinedSavings(left);
      if (savingsDelta !== 0) {
        return savingsDelta;
      }

      const idDelta = left.id.localeCompare(right.id);
      if (idDelta !== 0) {
        return idDelta;
      }

      return left.title.localeCompare(right.title);
    });

  return ranked.slice(0, MAX_OPPORTUNITIES);
}

function getChromeFlags(): string[] {
  const flags = ["--headless", "--disable-gpu"];

  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  if (isCI) {
    flags.push("--no-sandbox", "--disable-setuid-sandbox");
  }

  return flags;
}

interface PortableLighthouseRuntime {
  restore: () => Promise<void>;
  userDataDir?: string;
}

async function closePuppeteerPage(page: PuppeteerPageLike | null, logger: Logger): Promise<void> {
  if (!page) {
    return;
  }

  try {
    await page.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    logger.debug(`Failed to close Lighthouse page: ${message}`);
  }
}

async function disconnectPuppeteerBrowser(
  browser: PuppeteerBrowserLike | null,
  logger: Logger
): Promise<void> {
  if (!browser) {
    return;
  }

  try {
    await browser.disconnect();
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    logger.debug(`Failed to disconnect Lighthouse browser: ${message}`);
  }
}

async function applyPortableLighthouseEnv(outDir: string, logger: Logger): Promise<PortableLighthouseRuntime> {
  const previousLocalAppData = process.env.LOCALAPPDATA;
  const previousTemp = process.env.TEMP;
  const previousTmp = process.env.TMP;

  if (process.platform === "win32") {
    return { restore: async () => {} };
  }

  await mkdir(outDir, { recursive: true });
  const runtimeRoot = await mkdtemp(path.join(outDir, ".lighthouse-runtime-"));
  const portableLocalAppData = path.join(runtimeRoot, "localappdata");
  const portableTemp = path.join(runtimeRoot, "temp");
  const portableProfile = path.join(runtimeRoot, "profile");
  await mkdir(portableLocalAppData, { recursive: true });
  await mkdir(portableTemp, { recursive: true });
  await mkdir(portableProfile, { recursive: true });

  process.env.LOCALAPPDATA = portableLocalAppData;
  process.env.TEMP = portableTemp;
  process.env.TMP = portableTemp;
  logger.debug(`Using portable Lighthouse runtime root at ${runtimeRoot}`);

  return {
    userDataDir: portableProfile,
    restore: async () => {
      if (previousLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previousLocalAppData;
      }
      if (previousTemp === undefined) {
        delete process.env.TEMP;
      } else {
        process.env.TEMP = previousTemp;
      }
      if (previousTmp === undefined) {
        delete process.env.TMP;
      } else {
        process.env.TMP = previousTmp;
      }
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  };
}

/**
 * Resolve a Chrome/Chromium executable path for Lighthouse.
 *
 * Priority:
 *  1. $CHROME_PATH environment variable (user override)
 *  2. Playwright's bundled Chromium (detected via playwright module)
 *  3. undefined — let chrome-launcher search system defaults
 */
function resolveChromePath(): string | undefined {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  // Try Playwright's bundled Chromium
  try {
    const pw = requireSync("playwright") as { chromium: { executablePath: () => string } };
    const execPath = pw.chromium.executablePath();
    if (execPath && existsSync(execPath)) {
      return execPath;
    }
  } catch {
    // Playwright not installed — fall through
  }

  return undefined;
}

function buildLighthouseHeaders(auth: AuditAuth | null): Record<string, string> | null {
  if (!auth) {
    return null;
  }

  const headers: Record<string, string> = { ...auth.headers };
  if (!headers.Cookie) {
    const cookieHeader = toCookieHeader(auth.cookies);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
  }

  return Object.keys(headers).length > 0 ? headers : null;
}

export async function runLighthouseAudit(
  url: string,
  outDir: string,
  config: Config,
  logger: Logger,
  auth: AuditAuth | null = null,
  options: LighthouseRunOptions = {}
): Promise<LighthouseSummary> {
  logger.debug("Running Lighthouse audit");
  const runtime = await applyPortableLighthouseEnv(outDir, logger);
  const initialTarget =
    options.targetPolicy
      ? await resolveAuditedTarget(url, logger, options.targetPolicy, {
          context: "Lighthouse target"
        })
      : null;
  const effectiveHostResolverRules = options.hostResolverRules ?? initialTarget?.hostResolverRules ?? null;
  const chromePath = resolveChromePath();
  if (chromePath) {
    logger.debug(`Using Chrome at: ${chromePath}`);
  }
  try {
    const chromeFlags = getChromeFlags();
    if (effectiveHostResolverRules) {
      chromeFlags.push(`--host-resolver-rules=${effectiveHostResolverRules}`);
    }
    const chrome = await launch({
      chromeFlags,
      ...(runtime.userDataDir ? { userDataDir: runtime.userDataDir } : {}),
      ...(chromePath ? { chromePath } : {})
    });
    let puppeteerBrowser: PuppeteerBrowserLike | null = null;
    let puppeteerPage: PuppeteerPageLike | null = null;
    let blockedRequestError: Error | null = null;
    try {
      const verifiedNavigationTargets = new Map<string, { url: string; hostResolverRules: string | null }>();
      const pinnedHostResolverRules = new Map<string, string | null>();

      if (initialTarget) {
        pinnedHostResolverRules.set(initialTarget.classification.hostname, effectiveHostResolverRules);
      }

      const cachePinnedTarget = (
        targetUrl: string,
        verifiedTarget: { url: string; hostResolverRules: string | null }
      ) => {
        const verifiedHostname = normalizeUrlHostname(verifiedTarget.url);
        if (!pinnedHostResolverRules.has(verifiedHostname)) {
          return;
        }

        verifiedNavigationTargets.set(targetUrl, verifiedTarget);
        verifiedNavigationTargets.set(verifiedTarget.url, verifiedTarget);
      }

      const verifyNavigationTarget = async (targetUrl: string, contextLabel: string) => {
        if (!options.targetPolicy) {
          return null;
        }

        const existing = verifiedNavigationTargets.get(targetUrl);
        if (existing) {
          return existing;
        }

        const targetHostname = normalizeUrlHostname(targetUrl);
        if (pinnedHostResolverRules.has(targetHostname)) {
          const trustedTarget = {
            url: new URL(targetUrl).toString(),
            hostResolverRules: pinnedHostResolverRules.get(targetHostname) ?? null
          };
          cachePinnedTarget(targetUrl, trustedTarget);
          return trustedTarget;
        }

        const resolvedTarget = await resolveAuditedTarget(targetUrl, logger, options.targetPolicy, {
          context: contextLabel
        });
        const verifiedTarget = {
          url: resolvedTarget.url,
          hostResolverRules: resolvedTarget.hostResolverRules
        };
        cachePinnedTarget(targetUrl, verifiedTarget);
        return verifiedTarget;
      };

      if (options.targetPolicy) {
        const puppeteer = await loadLighthousePuppeteer();
        puppeteerBrowser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${chrome.port}`,
          defaultViewport: null
        });
        puppeteerPage = await puppeteerBrowser.newPage();
        await puppeteerPage.setRequestInterception(true);
        puppeteerPage.on("request", async (request) => {
          if (!isAuditableHttpUrl(request.url())) {
            await request.continue();
            return;
          }

          try {
            const contextLabel = request.isNavigationRequest()
              ? "Lighthouse navigation target"
              : "Lighthouse request target";
            await verifyNavigationTarget(request.url(), contextLabel);
            await request.continue();
          } catch (error) {
            blockedRequestError ??= toError(error, "Blocked Lighthouse request");
            await request.abort("blockedbyclient");
          }
        });
      }

      const retryCount = config.retries?.count ?? 1;
      const retryDelayMs = config.retries?.delayMs ?? 2000;
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

      const lhHeaders = buildLighthouseHeaders(auth);
      const runnerFlags = {
        port: chrome.port,
        output: "json" as const,
        logLevel: "error" as const,
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        ...(lhHeaders ? { extraHeaders: lhHeaders } : {})
      };
      const lighthouseConfig = {
        extends: "lighthouse:default",
        settings: {
          formFactor: config.lighthouse.formFactor,
          screenEmulation
        }
      };

      const runnerResult = await retry(
        async () => {
          try {
            const result = puppeteerPage
              ? await lighthouse(url, runnerFlags, lighthouseConfig, puppeteerPage as never)
              : await lighthouse(url, runnerFlags, lighthouseConfig);
            if (blockedRequestError) {
              throw blockedRequestError;
            }
            return result;
          } catch (error) {
            throw blockedRequestError ?? toError(error, "Lighthouse run failed");
          }
        },
        {
          maxRetries: retryCount,
          baseDelayMs: retryDelayMs,
          logger,
          isRetryable: (error) => !(error instanceof UsageError)
        }
      );

      if (blockedRequestError) {
        throw blockedRequestError;
      }

      if (!runnerResult?.lhr) {
        throw new Error("Lighthouse did not return a result");
      }

      const lhr = runnerResult.lhr as LighthouseLhrLike;
      const finalNavigationUrl =
        typeof lhr.finalDisplayedUrl === "string"
          ? lhr.finalDisplayedUrl
          : typeof lhr.finalUrl === "string"
            ? lhr.finalUrl
            : url;
      if (options.targetPolicy) {
        if (normalizeUrlHostname(finalNavigationUrl) !== normalizeUrlHostname(url)) {
          await verifyNavigationTarget(finalNavigationUrl, "final Lighthouse target");
        }
      }
      const lcpAudit = lhr.audits["largest-contentful-paint"];
      const clsAudit = lhr.audits["cumulative-layout-shift"];
      const tbtAudit = lhr.audits["total-blocking-time"];

      const metrics: LighthouseMetrics = {
        performanceScore: categoryScore(lhr, "performance"),
        lcpMs: toNumericValue(lcpAudit?.numericValue),
        cls: toNumericValue(clsAudit?.numericValue),
        tbtMs: toNumericValue(tbtAudit?.numericValue)
      };

      const budgets = config.lighthouse.budgets;
      const budgetResults = evaluateBudgets(metrics, budgets);

      const categoryScores: LighthouseCategoryScores = {
        performance: categoryScore(lhr, "performance"),
        accessibility: categoryScore(lhr, "accessibility"),
        bestPractices: categoryScore(lhr, "best-practices"),
        seo: categoryScore(lhr, "seo")
      };

      const reportPath = path.join(outDir, "lighthouse.json");
      await writeJson(reportPath, runnerResult.lhr);

      return {
        metrics,
        budgets,
        budgetResults,
        reportPath,
        categoryScores,
        extendedMetrics: extractExtendedMetrics(lhr),
        opportunities: extractOpportunities(lhr)
      };
    } finally {
      await closePuppeteerPage(puppeteerPage, logger);
      await disconnectPuppeteerBrowser(puppeteerBrowser, logger);
      await chrome.kill();
    }
  } finally {
    await runtime.restore();
  }
}
