import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Config } from "../config/schema.js";
import { writeJson } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import type { AuditAuth } from "../utils/auth.js";
import { applyScopedAuthHeaders, toCookieHeader } from "../utils/auth.js";
import {
  isBrowserExecutableFile,
  resolveBrowserExecutablePath
} from "../utils/browserExecutable.js";
import {
  loadLighthousePuppeteer,
  type PuppeteerBrowserLike,
  type PuppeteerPageLike
} from "./lighthousePuppeteer.js";
import {
  NavigationTargetVerifier,
  isAuditableHttpUrl,
  normalizeUrlHostname,
  resolveAuditedTarget,
  UsageError,
  type TargetResolutionPolicy,
  type VerifiedAuditTarget
} from "../utils/url.js";
import {
  addVerifiedResolverHost,
  assertResolverRelaunchAvailable,
  buildHostResolverRuleArgument,
  combineHostResolverRules,
  ResolverPinningBudgetError,
  reserveResolverHost
} from "./resolverPinning.js";

const requireSync = createRequire(import.meta.url);

const MAX_OPPORTUNITIES = 10;
const LOCAL_DATA_ENV_KEY = "LOCAL" + "APP" + "DATA";

class ResolverPinningRequiredError extends Error {
  constructor(readonly hostname: string) {
    super(`Lighthouse resolver pinning required for ${hostname}`);
    this.name = "ResolverPinningRequiredError";
  }
}

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

interface LighthouseAttemptResult {
  summary: LighthouseSummary;
  finalNavigationUrl: string;
  finalTarget: VerifiedAuditTarget | null;
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

async function applyPortableLighthouseEnv(
  outDir: string,
  logger: Logger
): Promise<PortableLighthouseRuntime> {
  const previousLocalDataRoot = process.env[LOCAL_DATA_ENV_KEY];
  const previousTemp = process.env.TEMP;
  const previousTmp = process.env.TMP;

  if (process.platform === "win32") {
    return { restore: async () => {} };
  }

  await mkdir(outDir, { recursive: true });
  const runtimeRoot = await mkdtemp(path.join(outDir, ".lighthouse-runtime-"));
  const portableLocalDataRoot = path.join(runtimeRoot, "localdata");
  const portableTemp = path.join(runtimeRoot, "temp");
  const portableProfile = path.join(runtimeRoot, "profile");
  await mkdir(portableLocalDataRoot, { recursive: true });
  await mkdir(portableTemp, { recursive: true });
  await mkdir(portableProfile, { recursive: true });

  process.env[LOCAL_DATA_ENV_KEY] = portableLocalDataRoot;
  process.env.TEMP = portableTemp;
  process.env.TMP = portableTemp;
  logger.debug(`Using portable Lighthouse runtime root at ${runtimeRoot}`);

  return {
    userDataDir: portableProfile,
    restore: async () => {
      if (previousLocalDataRoot === undefined) {
        delete process.env[LOCAL_DATA_ENV_KEY];
      } else {
        process.env[LOCAL_DATA_ENV_KEY] = previousLocalDataRoot;
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
  const systemChromePath = resolveBrowserExecutablePath(process.env.CHROME_PATH);
  if (systemChromePath) {
    return systemChromePath;
  }

  // Try Playwright's bundled Chromium
  try {
    const pw = requireSync("playwright") as { chromium: { executablePath: () => string } };
    const execPath = pw.chromium.executablePath();
    if (execPath && isBrowserExecutableFile(execPath)) {
      return execPath;
    }
  } catch {
    // Playwright not installed - fall through
  }

  return undefined;
}

async function killChromeQuietly(
  chrome: { kill: () => void | Promise<void> } | null,
  logger: Logger
): Promise<void> {
  if (!chrome) {
    return;
  }
  try {
    await chrome.kill();
  } catch (error) {
    logger.debug(
      `Ignoring Lighthouse Chrome cleanup failure: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function restoreRuntimeQuietly(
  runtime: { restore: () => Promise<void> },
  logger: Logger
): Promise<void> {
  try {
    await runtime.restore();
  } catch (error) {
    logger.debug(
      `Ignoring Lighthouse runtime cleanup failure: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function buildLighthouseHeaders(auth: AuditAuth | null): Record<string, string> | null {
  if (!auth) {
    return null;
  }

  const headers: Record<string, string> = { ...auth.headers };
  const hasCookieHeader = Object.keys(headers).some((key) => key.toLowerCase() === "cookie");
  if (!hasCookieHeader) {
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
  const initialTarget = options.targetPolicy
    ? await resolveAuditedTarget(url, logger, options.targetPolicy, {
        context: "Lighthouse target"
      })
    : null;
  const authHeaders = buildLighthouseHeaders(auth);
  const authTargetUrl = initialTarget?.url ?? url;
  const chromePath = resolveChromePath();
  if (chromePath) {
    logger.debug(`Using Chrome at: ${chromePath}`);
  }

  async function runAttempt(
    auditUrl: string,
    launchHostResolverRules: string | null,
    launchPinnedHostResolverRules: Map<string, string | null>
  ): Promise<LighthouseAttemptResult> {
    const chromeFlags = getChromeFlags();
    const resolverRuleArgument = buildHostResolverRuleArgument(
      launchHostResolverRules,
      "Lighthouse",
      normalizeUrlHostname(auditUrl)
    );
    if (resolverRuleArgument) {
      chromeFlags.push(resolverRuleArgument);
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
      const activePinnedHosts = new Map(launchPinnedHostResolverRules);
      const pendingResolverHosts = new Set<string>();
      const navigationTargetVerifier = new NavigationTargetVerifier(logger, options.targetPolicy, {
        initialTrustedHosts: activePinnedHosts,
        trustResolvedHosts: false
      });

      if (options.targetPolicy || authHeaders) {
        const puppeteer = await loadLighthousePuppeteer();
        puppeteerBrowser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${chrome.port}`,
          defaultViewport: null
        });
        puppeteerPage = await puppeteerBrowser.newPage();
        await puppeteerPage.setRequestInterception(true);
        puppeteerPage.on("request", async (request) => {
          let reservedHostname: string | null = null;
          try {
            if (options.targetPolicy && isAuditableHttpUrl(request.url())) {
              const hostname = normalizeUrlHostname(request.url());
              const reservation = reserveResolverHost(
                launchPinnedHostResolverRules,
                pendingResolverHosts,
                hostname,
                "Lighthouse"
              );
              if (reservation === "pending") {
                await request.abort("blockedbyclient");
                return;
              }
              if (reservation === "reserved") {
                reservedHostname = hostname;
              }
              const contextLabel = request.isNavigationRequest()
                ? "Lighthouse navigation target"
                : "Lighthouse request target";
              const verifiedTarget = await navigationTargetVerifier.verify(
                request.url(),
                contextLabel
              );
              if (!activePinnedHosts.has(hostname)) {
                addVerifiedResolverHost(
                  launchPinnedHostResolverRules,
                  hostname,
                  verifiedTarget?.hostResolverRules ?? null,
                  "Lighthouse"
                );
                if (verifiedTarget?.hostResolverRules) {
                  throw new ResolverPinningRequiredError(hostname);
                }
                activePinnedHosts.set(hostname, null);
              }
            }

            const scopedHeaders = applyScopedAuthHeaders({
              requestUrl: request.url(),
              targetUrl: authTargetUrl,
              requestHeaders: request.headers(),
              authHeaders
            });
            await request.continue({ headers: scopedHeaders });
          } catch (error) {
            const nextError = toError(error, "Blocked Lighthouse request");
            if (
              !blockedRequestError ||
              (nextError instanceof ResolverPinningBudgetError &&
                blockedRequestError instanceof ResolverPinningRequiredError)
            ) {
              blockedRequestError = nextError;
            }
            await request.abort("blockedbyclient");
          } finally {
            if (reservedHostname) {
              pendingResolverHosts.delete(reservedHostname);
            }
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

      const runnerFlags = {
        port: chrome.port,
        output: "json" as const,
        logLevel: "error" as const,
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"]
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
              ? await lighthouse(auditUrl, runnerFlags, lighthouseConfig, puppeteerPage as never)
              : await lighthouse(auditUrl, runnerFlags, lighthouseConfig);
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
          isRetryable: (error) =>
            !(error instanceof UsageError) && !(error instanceof ResolverPinningRequiredError)
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
            : auditUrl;
      let finalTarget: VerifiedAuditTarget | null = null;
      if (options.targetPolicy) {
        if (normalizeUrlHostname(finalNavigationUrl) !== normalizeUrlHostname(auditUrl)) {
          finalTarget = await navigationTargetVerifier.verify(
            finalNavigationUrl,
            "final Lighthouse target"
          );
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
        summary: {
          metrics,
          budgets,
          budgetResults,
          reportPath,
          categoryScores,
          extendedMetrics: extractExtendedMetrics(lhr),
          opportunities: extractOpportunities(lhr)
        },
        finalNavigationUrl,
        finalTarget
      };
    } finally {
      await closePuppeteerPage(puppeteerPage, logger);
      await disconnectPuppeteerBrowser(puppeteerBrowser, logger);
      await killChromeQuietly(chrome, logger);
    }
  }

  try {
    let currentAuditUrl = url;
    let currentLaunchHostResolverRules =
      options.hostResolverRules ?? initialTarget?.hostResolverRules ?? null;
    const launchPinnedHostResolverRules = new Map<string, string | null>();

    if (initialTarget) {
      addVerifiedResolverHost(
        launchPinnedHostResolverRules,
        initialTarget.classification.hostname,
        currentLaunchHostResolverRules,
        "Lighthouse"
      );
    }

    for (let relaunchCount = 0; ; relaunchCount += 1) {
      let attempt: LighthouseAttemptResult;
      try {
        attempt = await runAttempt(
          currentAuditUrl,
          currentLaunchHostResolverRules,
          launchPinnedHostResolverRules
        );
      } catch (error) {
        if (!(error instanceof ResolverPinningRequiredError) || !options.targetPolicy) {
          throw error;
        }
        assertResolverRelaunchAvailable("Lighthouse", relaunchCount, error.hostname);
        currentLaunchHostResolverRules = combineHostResolverRules(
          launchPinnedHostResolverRules
        );
        logger.debug(`Relaunching Lighthouse Chrome with resolver pin for ${error.hostname}`);
        continue;
      }

      if (!options.targetPolicy || !attempt.finalTarget) {
        return attempt.summary;
      }

      const finalHostname = normalizeUrlHostname(attempt.finalTarget.url);
      if (launchPinnedHostResolverRules.has(finalHostname)) {
        return attempt.summary;
      }

      assertResolverRelaunchAvailable("Lighthouse", relaunchCount, finalHostname);

      logger.debug("Relaunching Lighthouse Chrome with landing host resolver rules");
      currentAuditUrl = attempt.finalTarget.url;
      addVerifiedResolverHost(
        launchPinnedHostResolverRules,
        finalHostname,
        attempt.finalTarget.hostResolverRules,
        "Lighthouse"
      );
      currentLaunchHostResolverRules = combineHostResolverRules(
        launchPinnedHostResolverRules
      );
    }
  } finally {
    await restoreRuntimeQuietly(runtime, logger);
  }
}
