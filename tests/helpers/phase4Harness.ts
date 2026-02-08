import path from "node:path";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

export const mockLoadConfig = vi.fn();
export const mockOpenPage = vi.fn();
export const mockCaptureScreenshots = vi.fn();
export const mockRunAxeScan = vi.fn();
export const mockRunLighthouseAudit = vi.fn();
export const mockRunVisualDiff = vi.fn();

vi.mock("../../src/config/loadConfig.js", () => ({
  loadConfig: mockLoadConfig
}));
vi.mock("../../src/runner/playwright.js", () => ({
  openPage: mockOpenPage,
  captureScreenshots: mockCaptureScreenshots
}));
vi.mock("../../src/runner/axe.js", () => ({
  runAxeScan: mockRunAxeScan
}));
vi.mock("../../src/runner/lighthouse.js", () => ({
  runLighthouseAudit: mockRunLighthouseAudit
}));
vi.mock("../../src/runner/visualDiff.js", () => ({
  runVisualDiff: mockRunVisualDiff
}));
vi.mock("../../src/report/html.js", () => ({
  buildHtmlReport: () => "<html>phase4</html>"
}));

export function createRuntimeSignals() {
  return {
    console: {
      total: 0,
      errorCount: 0,
      warningCount: 0,
      dropped: 0,
      messages: []
    },
    jsErrors: {
      total: 0,
      dropped: 0,
      errors: []
    },
    network: {
      totalRequests: 0,
      failedRequests: 0,
      transferSizeBytes: 0,
      resourceTypeBreakdown: {}
    }
  };
}

export function createBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    timeouts: {
      navigationMs: 10000,
      actionMs: 5000,
      waitAfterLoadMs: 0
    },
    playwright: {
      viewport: {
        width: 1280,
        height: 720
      },
      userAgent: "wqg-test/0.0.0",
      locale: "en-US",
      colorScheme: "light"
    },
    screenshots: [{ name: "home", path: "/", fullPage: true }],
    lighthouse: {
      budgets: {
        performance: 0.8,
        lcpMs: 2500,
        cls: 0.1,
        tbtMs: 200
      },
      formFactor: "desktop"
    },
    visual: {
      threshold: 0.01
    },
    toggles: {
      a11y: false,
      perf: false,
      visual: false
    },
    ...overrides
  };
}

export function createA11ySummary(outDir: string, violations: number) {
  return {
    violations,
    countsByImpact: {
      critical: violations,
      serious: 0,
      moderate: 0,
      minor: 0
    },
    reportPath: path.join(outDir, "axe.json"),
    details: [],
    metadata: {
      totalViolations: violations,
      keptViolations: violations,
      droppedViolations: 0,
      droppedNodes: 0
    }
  };
}

export function createSummaryV2Validator() {
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), "schemas", "summary.v2.json"), "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

export async function createRunDirs(tempDirs: string[]) {
  const root = await mkdtemp(path.join(process.cwd(), ".tmp-phase4-"));
  tempDirs.push(root);
  return {
    outDir: path.join(root, "artifacts"),
    baselineDir: path.join(root, "baselines"),
    configPath: path.join(root, "config.json")
  };
}

export async function cleanupTempDirs(tempDirs: string[]): Promise<void> {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
}

export function resetPhase4Mocks(): void {
  vi.resetModules();
  vi.clearAllMocks();

  mockOpenPage.mockResolvedValue({
    browser: { close: vi.fn() },
    page: {},
    runtimeSignals: {
      snapshot: () => createRuntimeSignals()
    }
  });

  mockCaptureScreenshots.mockImplementation(async (_page, baseUrl: string, _config, screenshotsDir: string) => {
    return [
      {
        name: "home",
        path: path.join(screenshotsDir, "home.png"),
        url: `${baseUrl}`,
        fullPage: true
      }
    ];
  });

  mockRunAxeScan.mockImplementation(async (_page, outDir: string) => createA11ySummary(outDir, 0));
  mockRunLighthouseAudit.mockResolvedValue(null);
  mockRunVisualDiff.mockResolvedValue(null);
}
