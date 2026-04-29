import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { AuditSummaryV2 } from "../src/audit/orchestration.js";

function createSummaryFixture(): AuditSummaryV2 {
  return {
    $schema: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
    schemaVersion: "2.2.0",
    toolVersion: "6.1.2",
    mode: "single",
    overallStatus: "pass",
    startedAt: "2026-03-12T00:00:00.000Z",
    durationMs: 1000,
    primaryUrl: "https://example.com",
    schemaPointers: {
      v1: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
      v2: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json"
    },
    schemaVersions: {
      v1: "1.1.0",
      v2: "2.2.0"
    },
    compatibility: {
      v1SummaryPath: "summary.json",
      v1Schema: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
      v1SchemaVersion: "1.1.0",
      note: "compat"
    },
    artifacts: {
      summary: "summary.json",
      summaryV2: "summary.v2.json",
      report: "report.html",
      trendDashboardHtml: null,
      trendHistoryJson: null,
      actionPlanMd: null
    },
    rollup: {
      pageCount: 1,
      failedPages: 0,
      a11yViolations: 0,
      performanceBudgetFailures: 0,
      visualFailures: 0
    },
    pages: [
      {
        index: 0,
        name: "home",
        url: "https://example.com",
        overallStatus: "pass",
        startedAt: "2026-03-12T00:00:00.000Z",
        durationMs: 1000,
        steps: {
          playwright: "pass",
          a11y: "skipped",
          perf: "skipped",
          visual: "skipped"
        },
        artifacts: {
          summary: "summary.json",
          summaryV2: "summary.v2.json",
          report: "report.html"
        },
        metrics: {
          a11yViolations: 0,
          performanceScore: null,
          maxMismatchRatio: null,
          consoleErrors: 0,
          jsErrors: 0,
          failedRequests: 0
        },
        details: {
          $schema: "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
          schemaVersion: "2.2.0",
          toolVersion: "6.1.2",
          overallStatus: "pass",
          url: "https://example.com",
          startedAt: "2026-03-12T00:00:00.000Z",
          durationMs: 1000,
          steps: {
            playwright: "pass",
            a11y: "skipped",
            perf: "skipped",
            visual: "skipped"
          },
          artifacts: {
            summary: "summary.json",
            summaryV2: "summary.v2.json",
            report: "report.html",
            axe: null,
            lighthouse: null,
            screenshotsDir: "screenshots",
            diffsDir: "diffs",
            baselineDir: "baselines"
          },
          screenshots: [],
          a11y: null,
          performance: null,
          visual: null,
          runtimeSignals: {
            console: { total: 0, errorCount: 0, warningCount: 0, dropped: 0, messages: [] },
            jsErrors: { total: 0, dropped: 0, errors: [] },
            network: { totalRequests: 0, failedRequests: 0, transferSizeBytes: 0, resourceTypeBreakdown: {} }
          },
          insights: null
        }
      }
    ],
    trend: {
      status: "disabled",
      historyDir: null,
      previousSnapshotPath: null,
      message: null,
      metrics: null,
      pages: [],
      history: null,
      insights: []
    },
    insights: null
  };
}

describe("trend snapshot regression coverage", () => {
  it("rejects malformed v2 history snapshots as incompatible", async () => {
    const historyDir = await mkdtemp(path.join(tmpdir(), "wqg-trend-malformed-"));
    const logger = { warn: vi.fn() };
    const malformed = {
      schemaVersion: "2.2.0",
      pages: [],
      rollup: { pageCount: 1 }
    };

    await writeFile(
      path.join(historyDir, "2026-02-08T00-00-00-000Z.summary.v2.json"),
      JSON.stringify(malformed),
      "utf8"
    );

    try {
      const { loadLatestTrendSnapshot } = await import("../src/audit/orchestration.js");
      const loaded = await loadLatestTrendSnapshot(historyDir, logger);

      expect(loaded.snapshot).toBeNull();
      expect(loaded.hadIncompatibleSnapshot).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      await rm(historyDir, { recursive: true, force: true });
    }
  });

  it("tolerates ENOENT during pruning when another process deletes the same snapshot", async () => {
    const historyDir = await mkdtemp(path.join(tmpdir(), "wqg-trend-prune-"));
    const originalFs = await vi.importActual("node:fs/promises");
    const unlinkSpy = vi.fn(async () => {
      const error = Object.assign(new Error("missing"), { code: "ENOENT" });
      throw error;
    });

    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      unlink: unlinkSpy
    }));

    try {
      const { writeTrendSnapshot } = await import("../src/audit/orchestration.js");
      await expect(writeTrendSnapshot(historyDir, createSummaryFixture(), 0)).resolves.toBeUndefined();
      expect(unlinkSpy).toHaveBeenCalled();
    } finally {
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      await rm(historyDir, { recursive: true, force: true });
    }
  });
});
