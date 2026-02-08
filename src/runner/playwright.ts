import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import type { Config, ScreenshotDefinition } from "../config/schema.js";
import { ensureDir } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import { retry } from "../utils/retry.js";

export interface ScreenshotResult {
  name: string;
  path: string;
  url: string;
  fullPage: boolean;
}

export function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
}

export function validateScreenshotPath(shotPath: string): void {
  // Prevent SSRF: screenshot paths must be relative paths, not absolute URLs
  if (shotPath.includes("://")) {
    throw new Error(`Screenshot path must be a relative path, not a URL: ${shotPath}`);
  }
  // Must start with / to be a valid relative path from base URL
  if (!shotPath.startsWith("/")) {
    throw new Error(`Screenshot path must start with /: ${shotPath}`);
  }
}

export function resolveUrl(baseUrl: string, shotPath: string): string {
  validateScreenshotPath(shotPath);
  return new URL(shotPath, baseUrl).toString();
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
  logger: Logger
): Promise<{ browser: Browser; page: Page }> {
  logger.debug("Launching Playwright browser");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: config.playwright.viewport,
    userAgent: config.playwright.userAgent,
    locale: config.playwright.locale,
    colorScheme: config.playwright.colorScheme
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(config.timeouts.navigationMs);
  page.setDefaultTimeout(config.timeouts.actionMs);

  logger.debug(`Navigating to ${url}`);
  await retry(() => page.goto(url, { waitUntil: "networkidle" }), {
    retries: 1,
    delayMs: 2000,
    logger
  });
  await applyStabilityOverrides(page);
  await page.waitForTimeout(config.timeouts.waitAfterLoadMs);

  return { browser, page };
}

async function captureScreenshot(
  page: Page,
  baseUrl: string,
  shot: ScreenshotDefinition,
  outDir: string,
  logger: Logger
): Promise<ScreenshotResult> {
  const url = resolveUrl(baseUrl, shot.path);
  logger.debug(`Capturing screenshot ${shot.name} -> ${url}`);
  await retry(() => page.goto(url, { waitUntil: "networkidle" }), {
    retries: 1,
    delayMs: 2000,
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

export async function captureScreenshots(
  page: Page,
  baseUrl: string,
  config: Config,
  outDir: string,
  logger: Logger
): Promise<ScreenshotResult[]> {
  await ensureDir(outDir);
  const results: ScreenshotResult[] = [];
  for (const shot of config.screenshots) {
    const result = await captureScreenshot(page, baseUrl, shot, outDir, logger);
    results.push(result);
  }
  return results;
}
