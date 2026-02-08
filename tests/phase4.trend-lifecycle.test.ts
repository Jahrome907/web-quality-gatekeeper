import path from "node:path";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTempDirs,
  createA11ySummary,
  createBaseConfig,
  createRunDirs,
  createSummaryV2Validator,
  mockLoadConfig,
  mockRunAxeScan,
  resetPhase4Mocks
} from "./helpers/phase4Harness.js";

describe("phase4 trend lifecycle", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    resetPhase4Mocks();
  });

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("computes trend status and deltas for no_previous and ready states", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        },
        toggles: { a11y: true, perf: false, visual: false }
      })
    );

    let violations = 0;
    mockRunAxeScan.mockImplementation(async (_page, targetOutDir: string) => {
      return createA11ySummary(targetOutDir, violations);
    });

    const { runAudit } = await import("../src/index.js");

    const first = await runAudit("https://example.com", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(first.summaryV2.trend.status).toBe("no_previous");
    expect(first.summaryV2.trend.metrics).toBeNull();
    expect(typeof first.summaryV2.trend.message).toBe("string");

    violations = 2;

    const second = await runAudit("https://example.com", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(second.summaryV2.trend.status).toBe("ready");
    expect(second.summaryV2.trend.metrics).not.toBeNull();
    expect(second.summaryV2.trend.metrics?.failedPages.delta).toBe(1);
    expect(second.summaryV2.trend.metrics?.a11yViolations.delta).toBe(2);
    expect(second.summaryV2.trend.pages[0]?.a11yViolations.delta).toBe(2);
    expect(second.summaryV2.trend.pages[0]?.statusChanged).toBe(true);
  });

  it("handles incompatible previous snapshots safely", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);
    const historyDir = path.join(outDir, ".history");

    await mkdir(historyDir, { recursive: true });
    await writeFile(
      path.join(historyDir, "2026-02-08T00-00-00-000Z.summary.v2.json"),
      JSON.stringify({ schemaVersion: "1.1.0", pages: [] }),
      "utf8"
    );

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit("https://example.com", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(result.summaryV2.trend.status).toBe("incompatible_previous");
    expect(result.summaryV2.trend.metrics).toBeNull();
    expect(result.summaryV2.trend.message).toContain("No compatible previous snapshot");
  });

  it("handles corrupt previous snapshots safely", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);
    const historyDir = path.join(outDir, ".history");

    await mkdir(historyDir, { recursive: true });
    await writeFile(path.join(historyDir, "2026-02-08T00-00-00-000Z.summary.v2.json"), "{not-json", "utf8");

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit("https://example.com", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(result.summaryV2.trend.status).toBe("corrupt_previous");
    expect(result.summaryV2.trend.metrics).toBeNull();
    expect(result.summaryV2.trend.message).toContain("snapshots were corrupt");
  });

  it("keeps page ordering and artifact paths stable across repeated multi-page runs", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        urls: [
          { name: "Landing Page", url: "https://example.com/" },
          { name: "Checkout/Flow", url: "https://example.com/checkout" }
        ]
      })
    );

    const { runAudit } = await import("../src/index.js");
    const first = await runAudit(undefined, {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    const second = await runAudit(undefined, {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    expect(first.summaryV2.pages.map((page) => page.name)).toEqual(
      second.summaryV2.pages.map((page) => page.name)
    );
    expect(first.summaryV2.pages.map((page) => page.url)).toEqual(
      second.summaryV2.pages.map((page) => page.url)
    );
    expect(first.summaryV2.pages.map((page) => page.artifacts.summary)).toEqual(
      second.summaryV2.pages.map((page) => page.artifacts.summary)
    );
    expect(first.summaryV2.pages.map((page) => page.artifacts.summaryV2)).toEqual(
      second.summaryV2.pages.map((page) => page.artifacts.summaryV2)
    );
    expect(first.summaryV2.pages.map((page) => page.artifacts.report)).toEqual(
      second.summaryV2.pages.map((page) => page.artifacts.report)
    );
  });

  it("prunes trend snapshots to maxSnapshots without off-by-one errors", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 2
        }
      })
    );

    const { runAudit } = await import("../src/index.js");

    for (let i = 0; i < 3; i += 1) {
      await runAudit("https://example.com", {
        config: "ignored.json",
        out: outDir,
        baselineDir,
        setBaseline: false,
        failOnA11y: true,
        failOnPerf: true,
        failOnVisual: true,
        verbose: false,
        auth: null
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const historyDir = path.join(outDir, ".history");
    const snapshots = (await readdir(historyDir)).filter((entry) => entry.endsWith(".summary.v2.json"));

    expect(snapshots.length).toBe(2);
  });

  it("emits canonical runtime trend status tokens", async () => {
    const validateV2 = createSummaryV2Validator();
    const observed = new Set<string>();
    const { runAudit } = await import("../src/index.js");

    const disabledRun = await createRunDirs(tempDirs);
    mockLoadConfig.mockResolvedValueOnce(createBaseConfig());
    const disabled = await runAudit("https://example.com", {
      config: "ignored.json",
      out: disabledRun.outDir,
      baselineDir: disabledRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(disabled.summaryV2.trend.status);
    expect(validateV2(disabled.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const trendRun = await createRunDirs(tempDirs);
    mockLoadConfig.mockResolvedValue(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const noPrevious = await runAudit("https://example.com", {
      config: "ignored.json",
      out: trendRun.outDir,
      baselineDir: trendRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(noPrevious.summaryV2.trend.status);
    expect(validateV2(noPrevious.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const ready = await runAudit("https://example.com", {
      config: "ignored.json",
      out: trendRun.outDir,
      baselineDir: trendRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(ready.summaryV2.trend.status);
    expect(validateV2(ready.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const incompatibleRun = await createRunDirs(tempDirs);
    await mkdir(path.join(incompatibleRun.outDir, ".history"), { recursive: true });
    await writeFile(
      path.join(incompatibleRun.outDir, ".history", "2026-02-08T00-00-00-000Z.summary.v2.json"),
      JSON.stringify({ schemaVersion: "1.1.0", pages: [] }),
      "utf8"
    );

    mockLoadConfig.mockResolvedValueOnce(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const incompatible = await runAudit("https://example.com", {
      config: "ignored.json",
      out: incompatibleRun.outDir,
      baselineDir: incompatibleRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(incompatible.summaryV2.trend.status);
    expect(validateV2(incompatible.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    const corruptRun = await createRunDirs(tempDirs);
    await mkdir(path.join(corruptRun.outDir, ".history"), { recursive: true });
    await writeFile(
      path.join(corruptRun.outDir, ".history", "2026-02-08T00-00-00-000Z.summary.v2.json"),
      "{not-json",
      "utf8"
    );

    mockLoadConfig.mockResolvedValueOnce(
      createBaseConfig({
        trends: {
          enabled: true,
          historyDir: ".history",
          maxSnapshots: 10
        }
      })
    );

    const corrupt = await runAudit("https://example.com", {
      config: "ignored.json",
      out: corruptRun.outDir,
      baselineDir: corruptRun.baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });
    observed.add(corrupt.summaryV2.trend.status);
    expect(validateV2(corrupt.summaryV2), JSON.stringify(validateV2.errors, null, 2)).toBe(true);

    expect(Array.from(observed).sort()).toEqual(
      ["corrupt_previous", "disabled", "incompatible_previous", "no_previous", "ready"].sort()
    );
    expect(observed.has("no_previous_snapshot")).toBe(false);
    expect(observed.has("previous_snapshot_invalid")).toBe(false);
  });
});
