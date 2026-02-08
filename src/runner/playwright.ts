import path from "node:path";
import { chromium, type Browser, type ConsoleMessage, type Page } from "playwright";
import type { Config, ScreenshotDefinition } from "../config/schema.js";
import { ensureDir } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";
import type { AuditAuth } from "../utils/auth.js";

const MAX_CONSOLE_MESSAGES = 200;
const MAX_JS_ERRORS = 100;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_SEGMENT_CAPTURE_POINTS = 200;

export interface ScreenshotResult {
  name: string;
  path: string;
  url: string;
  fullPage: boolean;
}

export interface ConsoleMessageSummaryItem {
  type: string;
  text: string;
  location: string | null;
}

export interface JsErrorSummaryItem {
  message: string;
  stack: string | null;
}

export interface ConsoleSummary {
  total: number;
  errorCount: number;
  warningCount: number;
  dropped: number;
  messages: ConsoleMessageSummaryItem[];
}

export interface JsErrorSummary {
  total: number;
  dropped: number;
  errors: JsErrorSummaryItem[];
}

export interface NetworkRequestSummary {
  totalRequests: number;
  failedRequests: number;
  transferSizeBytes: number;
  resourceTypeBreakdown: Record<string, number>;
}

export interface RuntimeSignalSummary {
  console: ConsoleSummary;
  jsErrors: JsErrorSummary;
  network: NetworkRequestSummary;
}

export interface RuntimeSignalCollector {
  snapshot: () => RuntimeSignalSummary;
}

export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
}

export function validateScreenshotPath(shotPath: string): void {
  if (shotPath.includes("://")) {
    throw new Error(`Screenshot path must be a relative path, not a URL: ${shotPath}`);
  }
  if (!shotPath.startsWith("/")) {
    throw new Error(`Screenshot path must start with /: ${shotPath}`);
  }
}

export function resolveUrl(baseUrl: string, shotPath: string): string {
  validateScreenshotPath(shotPath);
  return new URL(shotPath, baseUrl).toString();
}

function truncateText(value: string, maxLength: number = MAX_MESSAGE_LENGTH): string {
  const normalized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function sanitizeConsoleLocation(message: ConsoleMessage): string | null {
  const location = message.location();
  if (!location?.url) {
    return null;
  }
  const line = typeof location.lineNumber === "number" ? location.lineNumber : 0;
  const column = typeof location.columnNumber === "number" ? location.columnNumber : 0;
  return `${location.url}:${line}:${column}`;
}

function toSortedBreakdown(source: Map<string, number>): Record<string, number> {
  const entries = Array.from(source.entries()).sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

function createRuntimeSignalCollector(page: Page): RuntimeSignalCollector {
  const maybePage = page as unknown as { on?: (event: string, handler: (...args: unknown[]) => void) => void };
  if (typeof maybePage.on !== "function") {
    return {
      snapshot: () => ({
        console: { total: 0, errorCount: 0, warningCount: 0, dropped: 0, messages: [] },
        jsErrors: { total: 0, dropped: 0, errors: [] },
        network: {
          totalRequests: 0,
          failedRequests: 0,
          transferSizeBytes: 0,
          resourceTypeBreakdown: {}
        }
      })
    };
  }

  let consoleTotal = 0;
  let consoleErrorCount = 0;
  let consoleWarningCount = 0;
  let consoleDropped = 0;
  const consoleMessages: ConsoleMessageSummaryItem[] = [];

  let jsErrorTotal = 0;
  let jsErrorDropped = 0;
  const jsErrors: JsErrorSummaryItem[] = [];

  let requestTotal = 0;
  let requestFailed = 0;
  let transferSizeBytes = 0;
  const resourceTypeBreakdown = new Map<string, number>();

  maybePage.on("console", (message) => {
    const consoleMessage = message as ConsoleMessage;
    consoleTotal += 1;
    const messageType = consoleMessage.type();
    if (messageType === "error") {
      consoleErrorCount += 1;
    } else if (messageType === "warning") {
      consoleWarningCount += 1;
    }

    if (consoleMessages.length >= MAX_CONSOLE_MESSAGES) {
      consoleDropped += 1;
      return;
    }

    consoleMessages.push({
      type: messageType,
      text: truncateText(consoleMessage.text()),
      location: sanitizeConsoleLocation(consoleMessage)
    });
  });

  maybePage.on("pageerror", (error) => {
    const pageError = error as Error;
    jsErrorTotal += 1;
    if (jsErrors.length >= MAX_JS_ERRORS) {
      jsErrorDropped += 1;
      return;
    }

    jsErrors.push({
      message: truncateText(pageError.message),
      stack: pageError.stack ? truncateText(pageError.stack, MAX_MESSAGE_LENGTH * 2) : null
    });
  });

  maybePage.on("request", (request) => {
    const networkRequest = request as { resourceType: () => string };
    requestTotal += 1;
    const type = networkRequest.resourceType();
    const previous = resourceTypeBreakdown.get(type) ?? 0;
    resourceTypeBreakdown.set(type, previous + 1);
  });

  maybePage.on("requestfailed", () => {
    requestFailed += 1;
  });

  maybePage.on("response", (response) => {
    const networkResponse = response as { headers: () => Record<string, string> };
    const contentLength = networkResponse.headers()["content-length"];
    if (!contentLength) {
      return;
    }
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      transferSizeBytes += parsed;
    }
  });

  return {
    snapshot: () => ({
      console: {
        total: consoleTotal,
        errorCount: consoleErrorCount,
        warningCount: consoleWarningCount,
        dropped: consoleDropped,
        messages: consoleMessages.slice()
      },
      jsErrors: {
        total: jsErrorTotal,
        dropped: jsErrorDropped,
        errors: jsErrors.slice()
      },
      network: {
        totalRequests: requestTotal,
        failedRequests: requestFailed,
        transferSizeBytes,
        resourceTypeBreakdown: toSortedBreakdown(resourceTypeBreakdown)
      }
    })
  };
}

async function applyStabilityOverrides(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*{animation:none !important;transition:none !important;scroll-behavior:auto !important;}`
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
}

export async function openPage(
  url: string,
  config: Config,
  logger: Logger,
  auth: AuditAuth | null = null
): Promise<{ browser: Browser; page: Page; runtimeSignals: RuntimeSignalCollector }> {
  logger.debug("Launching Playwright browser");
  const browser = await chromium.launch({ headless: true });
  const extraHeaders = auth?.headers && Object.keys(auth.headers).length > 0 ? auth.headers : null;
  const context = await browser.newContext({
    viewport: config.playwright.viewport,
    userAgent: config.playwright.userAgent,
    locale: config.playwright.locale,
    colorScheme: config.playwright.colorScheme,
    ...(extraHeaders ? { extraHTTPHeaders: extraHeaders } : {})
  });

  if (auth?.cookies.length) {
    await context.addCookies(
      auth.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url
      }))
    );
  }

  const page = await context.newPage();
  const runtimeSignals = createRuntimeSignalCollector(page);
  page.setDefaultNavigationTimeout(config.timeouts.navigationMs);
  page.setDefaultTimeout(config.timeouts.actionMs);

  const retryCount = config.retries?.count ?? 1;
  const retryDelayMs = config.retries?.delayMs ?? 2000;

  logger.debug(`Navigating to ${url}`);
  await retry(() => page.goto(url, { waitUntil: "load" }), {
    retries: retryCount,
    delayMs: retryDelayMs,
    logger
  });
  await applyStabilityOverrides(page);
  await page.waitForTimeout(config.timeouts.waitAfterLoadMs);

  return { browser, page, runtimeSignals };
}

async function captureScreenshot(
  page: Page,
  baseUrl: string,
  shot: ScreenshotDefinition,
  outDir: string,
  logger: Logger,
  retryCount: number,
  retryDelayMs: number
): Promise<ScreenshotResult> {
  const url = resolveUrl(baseUrl, shot.path);
  logger.debug(`Capturing screenshot ${shot.name} -> ${url}`);
  await retry(() => page.goto(url, { waitUntil: "load" }), {
    retries: retryCount,
    delayMs: retryDelayMs,
    logger
  });
  await applyStabilityOverrides(page);

  if (shot.waitForSelector) {
    await page.waitForSelector(shot.waitForSelector, { timeout: 10000 });
  }
  if (shot.waitForTimeoutMs) {
    await page.waitForTimeout(shot.waitForTimeoutMs);
  }
  await page.waitForTimeout(250);

  const filename = `${sanitizeName(shot.name)}.png`;
  const filePath = path.join(outDir, filename);
  await page.screenshot({ path: filePath, fullPage: shot.fullPage });

  return {
    name: shot.name,
    path: filePath,
    url,
    fullPage: shot.fullPage
  };
}

async function getScrollHeight(page: Page): Promise<number> {
  const value = await page.evaluate(() => {
    const body = document.body;
    const root = document.documentElement;
    const bodyHeight = body ? body.scrollHeight : 0;
    const rootHeight = root ? root.scrollHeight : 0;
    return Math.max(bodyHeight, rootHeight);
  });
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function buildSegmentOffsets(totalHeight: number, viewportHeight: number, maxScreenshots: number): number[] {
  if (maxScreenshots <= 1 || viewportHeight <= 0) {
    return [];
  }

  const maxOffset = Math.max(0, totalHeight - viewportHeight);
  if (maxOffset === 0) {
    return [];
  }

  const desiredExtraCount = Math.max(0, Math.min(maxScreenshots - 1, MAX_SEGMENT_CAPTURE_POINTS));
  const offsets = new Set<number>();

  for (let index = 1; index <= desiredExtraCount; index += 1) {
    const progress = index / desiredExtraCount;
    const offset = Math.round(maxOffset * progress);
    offsets.add(offset);
  }

  return Array.from(offsets).sort((left, right) => left - right);
}

async function captureViewportSegments(
  page: Page,
  shot: ScreenshotDefinition,
  screenshotBaseName: string,
  outDir: string,
  url: string,
  maxScreenshotsPerPath: number
): Promise<ScreenshotResult[]> {
  const viewport = page.viewportSize();
  const viewportHeight = viewport?.height ?? 0;
  const scrollHeight = await getScrollHeight(page);
  const offsets = buildSegmentOffsets(scrollHeight, viewportHeight, maxScreenshotsPerPath);

  const results: ScreenshotResult[] = [];
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index]!;
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, offset);
    await page.waitForTimeout(120);

    const filename = `${screenshotBaseName}--vp-${String(index + 1).padStart(2, "0")}.png`;
    const filePath = path.join(outDir, filename);
    await page.screenshot({ path: filePath, fullPage: false });
    results.push({
      name: `${shot.name} viewport ${index + 1}`,
      path: filePath,
      url,
      fullPage: false
    });
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });

  return results;
}

export async function captureScreenshots(
  page: Page,
  baseUrl: string,
  config: Config,
  outDir: string,
  logger: Logger
): Promise<ScreenshotResult[]> {
  await ensureDir(outDir);

  const retryCount = config.retries?.count ?? 1;
  const retryDelayMs = config.retries?.delayMs ?? 2000;
  const screenshotGalleryEnabled = config.screenshotGallery?.enabled ?? false;
  const maxScreenshotsPerPath = config.screenshotGallery?.maxScreenshotsPerPath ?? 12;

  const results: ScreenshotResult[] = [];
  for (const shot of config.screenshots) {
    const screenshotBaseName = sanitizeName(shot.name);
    const result = await captureScreenshot(
      page,
      baseUrl,
      shot,
      outDir,
      logger,
      retryCount,
      retryDelayMs
    );
    results.push(result);

    if (screenshotGalleryEnabled && shot.fullPage) {
      const galleryResults = await captureViewportSegments(
        page,
        shot,
        screenshotBaseName,
        outDir,
        result.url,
        maxScreenshotsPerPath
      );
      results.push(...galleryResults);
    }
  }
  return results;
}
