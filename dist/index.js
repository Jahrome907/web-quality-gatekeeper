// src/action.ts
import * as fs from "fs";
import * as path6 from "path";

// src/cli.ts
import { Command } from "commander";
import path5 from "path";

// src/config/loadConfig.ts
import { readFile } from "fs/promises";

// src/config/schema.ts
import { z } from "zod";
var MAX_SCREENSHOTS = 50;
var MAX_TIMEOUT_MS = 12e4;
var MAX_WAIT_TIMEOUT_MS = 3e4;
var ScreenshotSchema = z.object({
  name: z.string().min(1).max(100),
  path: z.string().min(1).max(500).refine(
    (p) => p.startsWith("/") && !p.includes("://"),
    { message: "Screenshot path must be a relative path starting with /" }
  ),
  fullPage: z.boolean().default(true),
  waitForSelector: z.string().min(1).max(500).optional(),
  waitForTimeoutMs: z.number().int().nonnegative().max(MAX_WAIT_TIMEOUT_MS).optional()
});
var ConfigSchema = z.object({
  timeouts: z.object({
    navigationMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    actionMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    waitAfterLoadMs: z.number().int().nonnegative().max(MAX_WAIT_TIMEOUT_MS)
  }),
  playwright: z.object({
    viewport: z.object({
      width: z.number().int().positive().max(7680),
      // 8K max
      height: z.number().int().positive().max(4320)
    }),
    userAgent: z.string().min(1).max(500),
    locale: z.string().min(1).max(20),
    colorScheme: z.enum(["light", "dark"])
  }),
  screenshots: z.array(ScreenshotSchema).min(1).max(MAX_SCREENSHOTS),
  lighthouse: z.object({
    budgets: z.object({
      performance: z.number().min(0).max(1),
      lcpMs: z.number().min(0),
      cls: z.number().min(0),
      tbtMs: z.number().min(0)
    }),
    formFactor: z.enum(["desktop", "mobile"])
  }),
  visual: z.object({
    threshold: z.number().min(0).max(1)
  }),
  toggles: z.object({
    a11y: z.boolean(),
    perf: z.boolean(),
    visual: z.boolean()
  })
});

// src/config/loadConfig.ts
function formatZodError(error) {
  return error.issues.map((issue) => {
    const path7 = issue.path.length > 0 ? issue.path.join(".") : "config";
    return `${path7}: ${issue.message}`;
  }).join("; ");
}
async function loadConfig(path7) {
  let raw;
  try {
    raw = await readFile(path7, "utf8");
  } catch {
    throw new Error(`Unable to read config file at ${path7}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file at ${path7}`);
  }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config: ${formatZodError(result.error)}`);
  }
  return result.data;
}

// src/runner/playwright.ts
import path from "path";
import { chromium } from "playwright";

// src/utils/fs.ts
import { copyFile, mkdir, stat, writeFile } from "fs/promises";
import { dirname, resolve, relative, isAbsolute } from "path";
function validateOutputDirectory(outDir) {
  const cwd = process.cwd();
  const resolvedOut = resolve(outDir);
  const relativePath = relative(cwd, resolvedOut);
  if (relativePath.startsWith("..")) {
    throw new Error(`Output directory must be within the working directory: ${outDir}`);
  }
}
async function ensureDir(path7) {
  await mkdir(path7, { recursive: true });
}
async function pathExists(path7) {
  try {
    await stat(path7);
    return true;
  } catch {
    return false;
  }
}
async function writeJson(path7, data) {
  await ensureDir(dirname(path7));
  const content = JSON.stringify(data, null, 2);
  await writeFile(path7, content, "utf8");
}
async function writeText(path7, content) {
  await ensureDir(dirname(path7));
  await writeFile(path7, content, "utf8");
}
async function copyFileSafe(source, destination) {
  await ensureDir(dirname(destination));
  await copyFile(source, destination);
}

// src/runner/playwright.ts
function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
}
function validateScreenshotPath(shotPath) {
  if (shotPath.includes("://")) {
    throw new Error(`Screenshot path must be a relative path, not a URL: ${shotPath}`);
  }
  if (!shotPath.startsWith("/")) {
    throw new Error(`Screenshot path must start with /: ${shotPath}`);
  }
}
function resolveUrl(baseUrl, shotPath) {
  validateScreenshotPath(shotPath);
  return new URL(shotPath, baseUrl).toString();
}
async function applyStabilityOverrides(page) {
  await page.addStyleTag({
    content: `*{animation:none !important;transition:none !important;scroll-behavior:auto !important;}`
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
}
async function openPage(url, config, logger) {
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
  await page.goto(url, { waitUntil: "networkidle" });
  await applyStabilityOverrides(page);
  await page.waitForTimeout(config.timeouts.waitAfterLoadMs);
  return { browser, page };
}
async function captureScreenshot(page, baseUrl, shot, outDir, logger) {
  const url = resolveUrl(baseUrl, shot.path);
  logger.debug(`Capturing screenshot ${shot.name} -> ${url}`);
  await page.goto(url, { waitUntil: "networkidle" });
  await applyStabilityOverrides(page);
  if (shot.waitForSelector) {
    await page.waitForSelector(shot.waitForSelector, { timeout: 1e4 });
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
async function captureScreenshots(page, baseUrl, config, outDir, logger) {
  await ensureDir(outDir);
  const results = [];
  for (const shot of config.screenshots) {
    const result = await captureScreenshot(page, baseUrl, shot, outDir, logger);
    results.push(result);
  }
  return results;
}

// src/runner/axe.ts
import AxeBuilder from "@axe-core/playwright";
import path2 from "path";
var impactLevels = [
  "critical",
  "serious",
  "moderate",
  "minor"
];
function countByImpact(violations) {
  const counts = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0
  };
  for (const violation of violations) {
    const impact = violation.impact ?? "";
    if (impactLevels.includes(impact)) {
      counts[impact] += 1;
    }
  }
  return counts;
}
async function runAxeScan(page, outDir, logger) {
  logger.debug("Running axe-core scan");
  const builder = new AxeBuilder({ page });
  const results = await builder.analyze();
  const reportPath = path2.join(outDir, "axe.json");
  await writeJson(reportPath, results);
  const countsByImpact = countByImpact(results.violations);
  return {
    violations: results.violations.length,
    countsByImpact,
    reportPath
  };
}

// src/runner/lighthouse.ts
import lighthouse from "lighthouse";
import { launch } from "chrome-launcher";
import path3 from "path";
function evaluateBudgets(metrics, budgets) {
  return {
    performance: metrics.performanceScore >= budgets.performance,
    lcp: metrics.lcpMs <= budgets.lcpMs,
    cls: metrics.cls <= budgets.cls,
    tbt: metrics.tbtMs <= budgets.tbtMs
  };
}
function toFixedScore(score) {
  if (typeof score !== "number") {
    return 0;
  }
  return Number(score.toFixed(2));
}
function getChromeFlags() {
  const flags = ["--headless", "--disable-gpu"];
  const isCI = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
  if (isCI) {
    flags.push("--no-sandbox", "--disable-setuid-sandbox");
  }
  return flags;
}
async function runLighthouseAudit(url, outDir, config, logger) {
  logger.debug("Running Lighthouse audit");
  const chrome = await launch({
    chromeFlags: getChromeFlags()
  });
  try {
    const isMobile = config.lighthouse.formFactor === "mobile";
    const screenEmulation = isMobile ? {
      mobile: true,
      width: 412,
      height: 823,
      deviceScaleFactor: 2
    } : {
      mobile: false,
      width: 1350,
      height: 940,
      deviceScaleFactor: 1
    };
    const runnerResult = await lighthouse(
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
    );
    if (!runnerResult?.lhr) {
      throw new Error("Lighthouse did not return a result");
    }
    const lhr = runnerResult.lhr;
    const lcpAudit = lhr.audits["largest-contentful-paint"];
    const clsAudit = lhr.audits["cumulative-layout-shift"];
    const tbtAudit = lhr.audits["total-blocking-time"];
    const metrics = {
      performanceScore: toFixedScore(lhr.categories.performance?.score ?? 0),
      lcpMs: typeof lcpAudit?.numericValue === "number" ? lcpAudit.numericValue : 0,
      cls: typeof clsAudit?.numericValue === "number" ? clsAudit.numericValue : 0,
      tbtMs: typeof tbtAudit?.numericValue === "number" ? tbtAudit.numericValue : 0
    };
    const budgets = config.lighthouse.budgets;
    const budgetResults = evaluateBudgets(metrics, budgets);
    const reportPath = path3.join(outDir, "lighthouse.json");
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

// src/runner/visualDiff.ts
import path4 from "path";
import { createHash } from "crypto";
import { readFile as readFile2, writeFile as writeFile2 } from "fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
var MANIFEST_FILENAME = "baseline-manifest.json";
function computeSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
async function loadManifest(baselineDir) {
  const manifestPath = path4.join(baselineDir, MANIFEST_FILENAME);
  if (!await pathExists(manifestPath)) {
    return null;
  }
  try {
    const raw = await readFile2(manifestPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function saveManifest(baselineDir, checksums) {
  const manifest = {
    version: 1,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    checksums
  };
  await writeJson(path4.join(baselineDir, MANIFEST_FILENAME), manifest);
}
async function verifyBaselineIntegrity(baselinePath, expectedHash, logger) {
  if (!expectedHash) {
    return true;
  }
  const buffer = await readFile2(baselinePath);
  const actualHash = computeSha256(buffer);
  if (actualHash !== expectedHash) {
    logger.warn(
      `Baseline integrity check failed for ${path4.basename(baselinePath)}. Expected: ${expectedHash.slice(0, 12)}..., Got: ${actualHash.slice(0, 12)}...`
    );
    return false;
  }
  return true;
}
function normalizePng(png, width, height) {
  const normalized = new PNG({ width, height });
  PNG.bitblt(png, normalized, 0, 0, png.width, png.height, 0, 0);
  return normalized;
}
async function readPng(filePath) {
  const buffer = await readFile2(filePath);
  return PNG.sync.read(buffer);
}
async function writePng(filePath, png) {
  const buffer = PNG.sync.write(png);
  await writeFile2(filePath, buffer);
}
function calculateMismatchRatio(diffPixels, width, height) {
  if (width === 0 || height === 0) {
    return 0;
  }
  return diffPixels / (width * height);
}
async function runVisualDiff(screenshots, baselineDir, diffDir, setBaseline, threshold, logger) {
  await ensureDir(baselineDir);
  await ensureDir(diffDir);
  const manifest = await loadManifest(baselineDir);
  const newChecksums = {};
  const results = [];
  let failed = false;
  let maxMismatchRatio = 0;
  for (const shot of screenshots) {
    const baseName = path4.basename(shot.path);
    const baselinePath = path4.join(baselineDir, baseName);
    const diffPath = path4.join(diffDir, baseName);
    const baselineExists = await pathExists(baselinePath);
    if (!baselineExists || setBaseline) {
      const status = baselineExists ? "baseline_updated" : "baseline_created";
      logger.debug(`Writing baseline for ${shot.name} (${status})`);
      await copyFileSafe(shot.path, baselinePath);
      const buffer = await readFile2(baselinePath);
      newChecksums[baseName] = computeSha256(buffer);
      results.push({
        name: shot.name,
        currentPath: shot.path,
        baselinePath,
        diffPath: null,
        mismatchRatio: null,
        status
      });
      continue;
    }
    const expectedHash = manifest?.checksums[baseName];
    const integrityOk = await verifyBaselineIntegrity(baselinePath, expectedHash, logger);
    if (!integrityOk) {
      logger.warn(`Skipping comparison for ${shot.name} due to integrity failure`);
      failed = true;
      results.push({
        name: shot.name,
        currentPath: shot.path,
        baselinePath,
        diffPath: null,
        mismatchRatio: null,
        status: "diffed"
      });
      continue;
    }
    if (expectedHash) {
      newChecksums[baseName] = expectedHash;
    }
    const currentPng = await readPng(shot.path);
    const baselinePng = await readPng(baselinePath);
    const width = Math.max(currentPng.width, baselinePng.width);
    const height = Math.max(currentPng.height, baselinePng.height);
    const currentNormalized = normalizePng(currentPng, width, height);
    const baselineNormalized = normalizePng(baselinePng, width, height);
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(
      baselineNormalized.data,
      currentNormalized.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );
    const mismatchRatio = calculateMismatchRatio(diffPixels, width, height);
    await writePng(diffPath, diff);
    maxMismatchRatio = Math.max(maxMismatchRatio, mismatchRatio);
    if (mismatchRatio > threshold) {
      failed = true;
    }
    results.push({
      name: shot.name,
      currentPath: shot.path,
      baselinePath,
      diffPath,
      mismatchRatio,
      status: "diffed"
    });
  }
  if (Object.keys(newChecksums).length > 0) {
    await saveManifest(baselineDir, newChecksums);
  }
  return {
    results,
    threshold,
    failed,
    maxMismatchRatio
  };
}

// src/report/summary.ts
function buildSummary(params) {
  const { a11y, performance, visual, options } = params;
  const a11yFail = Boolean(a11y && options.failOnA11y && a11y.violations > 0);
  const perfFail = Boolean(
    performance && options.failOnPerf && Object.values(performance.budgetResults).some((passed) => !passed)
  );
  const visualFail = Boolean(visual && options.failOnVisual && visual.failed);
  const steps = {
    playwright: "pass",
    a11y: a11y ? a11yFail ? "fail" : "pass" : "skipped",
    perf: performance ? perfFail ? "fail" : "pass" : "skipped",
    visual: visual ? visualFail ? "fail" : "pass" : "skipped"
  };
  const overallStatus = a11yFail || perfFail || visualFail ? "fail" : "pass";
  return {
    overallStatus,
    url: params.url,
    startedAt: params.startedAt,
    durationMs: params.durationMs,
    steps,
    artifacts: params.artifacts,
    screenshots: params.screenshots,
    a11y: params.a11y,
    performance: params.performance,
    visual: params.visual
  };
}

// src/report/templates/reportTemplate.ts
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function formatMs(value) {
  if (typeof value !== "number") {
    return "n/a";
  }
  return `${Math.round(value)} ms`;
}
function formatRatio(value) {
  if (typeof value !== "number") {
    return "n/a";
  }
  return value.toFixed(4);
}
function statusPill(status) {
  const normalized = status.toLowerCase();
  return `<span class="pill ${normalized}">${escapeHtml(status)}</span>`;
}
function renderReportTemplate(summary) {
  const a11y = summary.a11y;
  const perf = summary.performance;
  const visual = summary.visual;
  const a11yRows = a11y ? `
      <tr><th>Total violations</th><td>${a11y.violations}</td></tr>
      <tr><th>Critical</th><td>${a11y.countsByImpact.critical}</td></tr>
      <tr><th>Serious</th><td>${a11y.countsByImpact.serious}</td></tr>
      <tr><th>Moderate</th><td>${a11y.countsByImpact.moderate}</td></tr>
      <tr><th>Minor</th><td>${a11y.countsByImpact.minor}</td></tr>
    ` : `<tr><td colspan="2">Skipped</td></tr>`;
  const perfRows = perf ? `
      <tr><th>Performance score</th><td>${perf.metrics.performanceScore}</td></tr>
      <tr><th>LCP</th><td>${formatMs(perf.metrics.lcpMs)}</td></tr>
      <tr><th>CLS</th><td>${perf.metrics.cls.toFixed(3)}</td></tr>
      <tr><th>TBT</th><td>${formatMs(perf.metrics.tbtMs)}</td></tr>
      <tr><th>Budget pass</th><td>${Object.values(perf.budgetResults).every(Boolean) ? "pass" : "fail"}</td></tr>
    ` : `<tr><td colspan="2">Skipped</td></tr>`;
  const visualRows = visual ? visual.results.map((result) => {
    const diffLink = result.diffPath ? `<a href="${escapeHtml(result.diffPath)}">diff</a>` : "n/a";
    return `
            <tr>
              <th>${escapeHtml(result.name)}</th>
              <td>${escapeHtml(result.status)}</td>
              <td>${formatRatio(result.mismatchRatio)}</td>
              <td><a href="${escapeHtml(result.currentPath)}">current</a></td>
              <td><a href="${escapeHtml(result.baselinePath)}">baseline</a></td>
              <td>${diffLink}</td>
            </tr>
          `;
  }).join("") : `<tr><td colspan="6">Skipped</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Quality Gatekeeper Report</title>
  <style>
    :root {
      --bg: #f6f7fb;
      --card: #ffffff;
      --text: #1f2933;
      --muted: #667085;
      --accent: #2f80ed;
      --pass: #1b873f;
      --fail: #b42318;
      --skipped: #9b8c00;
      --border: #e4e7ec;
    }

    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: linear-gradient(120deg, #f6f7fb 0%, #eef3ff 60%, #fef6ee 100%);
      color: var(--text);
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }

    .header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 24px;
    }

    .header h1 {
      margin: 0;
      font-size: 28px;
    }

    .meta {
      color: var(--muted);
      font-size: 14px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 6px 16px rgba(31, 41, 51, 0.06);
    }

    .card h3 {
      margin: 0 0 8px;
      font-size: 16px;
      color: var(--muted);
    }

    .card strong {
      font-size: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-weight: 600;
    }

    .pill {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .pill.pass {
      background: #d1fae5;
      color: var(--pass);
    }

    .pill.fail {
      background: #fee4e2;
      color: var(--fail);
    }

    .pill.skipped {
      background: #fef7c3;
      color: var(--skipped);
    }

    .section {
      margin-bottom: 24px;
    }

    .section h2 {
      font-size: 20px;
      margin-bottom: 12px;
    }

    @media (max-width: 720px) {
      .container {
        padding: 24px 16px 40px;
      }

      table {
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Web Quality Gatekeeper</h1>
      <div class="meta">${escapeHtml(summary.url)}</div>
      <div class="meta">Started ${escapeHtml(summary.startedAt)} \xB7 Duration ${summary.durationMs} ms</div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Overall</h3>
        <strong>${statusPill(summary.overallStatus)}</strong>
      </div>
      <div class="card">
        <h3>Accessibility</h3>
        <strong>${statusPill(summary.steps.a11y)}</strong>
      </div>
      <div class="card">
        <h3>Performance</h3>
        <strong>${statusPill(summary.steps.perf)}</strong>
      </div>
      <div class="card">
        <h3>Visual</h3>
        <strong>${statusPill(summary.steps.visual)}</strong>
      </div>
    </div>

    <div class="section card">
      <h2>Accessibility</h2>
      <table>
        <tbody>
          ${a11yRows}
        </tbody>
      </table>
    </div>

    <div class="section card">
      <h2>Performance</h2>
      <table>
        <tbody>
          ${perfRows}
        </tbody>
      </table>
    </div>

    <div class="section card">
      <h2>Visual Diff</h2>
      <table>
        <thead>
          <tr>
            <th>View</th>
            <th>Status</th>
            <th>Mismatch</th>
            <th>Current</th>
            <th>Baseline</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody>
          ${visualRows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

// src/report/html.ts
function buildHtmlReport(summary) {
  return renderReportTemplate(summary);
}

// src/utils/logger.ts
function createLogger(verbose) {
  return {
    info: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
    debug: (message) => {
      if (verbose) {
        console.log(message);
      }
    }
  };
}

// src/utils/timing.ts
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function durationMs(start) {
  return Date.now() - start;
}

// src/cli.ts
var UsageError = class extends Error {
  exitCode = 2;
};
var INTERNAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  // Link-local / AWS metadata
  /^\[?::1\]?$/,
  // IPv6 localhost
  /^0\.0\.0\.0$/
];
function isInternalHost(hostname) {
  return INTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}
function validateUrl(raw) {
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
function toRelative(outDir, filePath) {
  const rel = path5.relative(outDir, filePath);
  return rel.split(path5.sep).join("/");
}
async function runAudit(rawUrl, options) {
  const { url, isInternal } = validateUrl(rawUrl);
  const configPath = path5.resolve(process.cwd(), options.config);
  const outDir = path5.resolve(process.cwd(), options.out);
  const baselineDir = path5.resolve(process.cwd(), options.baselineDir);
  const screenshotsDir = path5.join(outDir, "screenshots");
  const diffsDir = path5.join(outDir, "diffs");
  try {
    validateOutputDirectory(outDir);
    validateOutputDirectory(baselineDir);
  } catch (error) {
    throw new UsageError(error.message);
  }
  const logger = createLogger(options.verbose);
  if (isInternal) {
    logger.warn(
      `Auditing internal network address (${new URL(url).hostname}). Ensure this is intentional. See SECURITY.md for SSRF guidance.`
    );
  }
  logger.info("Starting audit");
  let config;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    throw new UsageError(error.message);
  }
  await ensureDir(outDir);
  await ensureDir(screenshotsDir);
  await ensureDir(diffsDir);
  const startedAt = nowIso();
  const startTime = Date.now();
  let axeSummary = null;
  let lighthouseSummary = null;
  let visualSummary = null;
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
    const relativeA11y = axeSummary ? { ...axeSummary, reportPath: toRelative(outDir, axeSummary.reportPath) } : null;
    const relativePerf = lighthouseSummary ? { ...lighthouseSummary, reportPath: toRelative(outDir, lighthouseSummary.reportPath) } : null;
    const relativeVisual = visualSummary ? {
      ...visualSummary,
      results: visualSummary.results.map((result) => ({
        ...result,
        currentPath: toRelative(outDir, result.currentPath),
        baselinePath: toRelative(outDir, result.baselinePath),
        diffPath: result.diffPath ? toRelative(outDir, result.diffPath) : null
      }))
    } : null;
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
    await writeJson(path5.join(outDir, "summary.json"), summary);
    const html = buildHtmlReport(summary);
    await writeText(path5.join(outDir, "report.html"), html);
    logger.info(`Overall status: ${summary.overallStatus}`);
    return summary.overallStatus === "fail" ? 1 : 0;
  } finally {
    await browser.close();
  }
}
var program = new Command();
program.name("wqg").description("Web Quality Gatekeeper");
program.command("audit").argument("<url>", "URL to audit").option("--config <path>", "Config file path", "configs/default.json").option("--out <dir>", "Output directory", "artifacts").option("--baseline-dir <dir>", "Baseline directory", "baselines").option("--set-baseline", "Overwrite baseline images", false).option("--no-fail-on-a11y", "Do not fail on accessibility violations").option("--no-fail-on-perf", "Do not fail on performance budget failures").option("--no-fail-on-visual", "Do not fail on visual diffs").option("--verbose", "Verbose logging", false).action(async (url, options) => {
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
    const message = error.message || "Unexpected error";
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

// src/action.ts
function getInput(name, required = false) {
  const key = `INPUT_${name.replace(/-/g, "_").toUpperCase()}`;
  const value = process.env[key] || "";
  if (required && !value) {
    throw new Error(`Input required: ${name}`);
  }
  return value;
}
function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${value}
`, "utf8");
  }
}
function getBooleanInput(name, defaultValue) {
  const value = getInput(name);
  if (!value) return defaultValue;
  return value === "true";
}
async function run() {
  try {
    const url = getInput("url", true);
    const config = getInput("config") || "configs/default.json";
    const baselineDir = getInput("baseline-dir") || "baselines";
    const outDir = getInput("out-dir") || "artifacts";
    const setBaseline = getBooleanInput("set-baseline", false);
    const failOnA11y = getBooleanInput("fail-on-a11y", true);
    const failOnPerf = getBooleanInput("fail-on-perf", true);
    const failOnVisual = getBooleanInput("fail-on-visual", true);
    const verbose = getBooleanInput("verbose", false);
    const exitCode = await runAudit(url, {
      config,
      out: outDir,
      baselineDir,
      setBaseline,
      failOnA11y,
      failOnPerf,
      failOnVisual,
      verbose
    });
    const summaryPath = path6.join(outDir, "summary.json");
    const reportPath = path6.join(outDir, "report.html");
    setOutput("summary-json", summaryPath);
    setOutput("report-html", reportPath);
    if (fs.existsSync(summaryPath)) {
      const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
      setOutput("status", summary.overallStatus || "unknown");
    } else {
      setOutput("status", "unknown");
    }
    process.exitCode = exitCode;
  } catch (error) {
    const message = error.message || "Unexpected error";
    console.error(message);
    process.exitCode = 1;
  }
}
run();
//# sourceMappingURL=index.js.map