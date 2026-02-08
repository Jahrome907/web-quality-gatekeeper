import { describe, expect, it } from "vitest";
import { buildSummary, SCHEMA_VERSION } from "../src/report/summary.js";
import { formatSummaryAsMarkdown } from "../src/report/markdown.js";
import type { AxeSummary } from "../src/runner/axe.js";
import type { LighthouseSummary } from "../src/runner/lighthouse.js";
import type { VisualDiffSummary } from "../src/runner/visualDiff.js";

/**
 * These tests guarantee the JSON summary shape does not change
 * without a deliberate schema version bump. Any field removal
 * or type change must increment SCHEMA_VERSION.
 */

const baseParams = {
  url: "https://example.com",
  startedAt: "2025-01-01T00:00:00.000Z",
  durationMs: 5000,
  toolVersion: "0.2.0",
  screenshots: [{ name: "home", path: "screenshots/home.png", url: "https://example.com/", fullPage: true }],
  artifacts: {
    summary: "summary.json",
    report: "report.html",
    axe: "axe.json",
    lighthouse: "lighthouse.json",
    screenshotsDir: "screenshots",
    diffsDir: "diffs",
    baselineDir: "../baselines"
  }
};

const a11y: AxeSummary = {
  violations: 2,
  countsByImpact: { critical: 1, serious: 0, moderate: 1, minor: 0 },
  reportPath: "axe.json"
};

const perf: LighthouseSummary = {
  metrics: { performanceScore: 0.92, lcpMs: 1800, cls: 0.05, tbtMs: 120 },
  budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
  budgetResults: { performance: true, lcp: true, cls: true, tbt: true },
  reportPath: "lighthouse.json"
};

const visual: VisualDiffSummary = {
  results: [],
  threshold: 0.01,
  failed: false,
  maxMismatchRatio: 0.002
};

describe("summary JSON schema contract", () => {
  it("contains all required top-level fields", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y,
      performance: perf,
      visual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    // These fields define the public contract. Removing any
    // of them is a breaking change that requires a version bump.
    const requiredFields = [
      "schemaVersion",
      "toolVersion",
      "overallStatus",
      "url",
      "startedAt",
      "durationMs",
      "steps",
      "artifacts",
      "screenshots",
      "a11y",
      "performance",
      "visual"
    ];

    for (const field of requiredFields) {
      expect(summary, `missing field: ${field}`).toHaveProperty(field);
    }
  });

  it("steps object has all four step keys", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y,
      performance: perf,
      visual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    expect(Object.keys(summary.steps).sort()).toEqual(
      ["a11y", "perf", "playwright", "visual"].sort()
    );
  });

  it("artifacts object has all required keys", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y,
      performance: perf,
      visual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    const requiredArtifactKeys = [
      "summary",
      "report",
      "axe",
      "lighthouse",
      "screenshotsDir",
      "diffsDir",
      "baselineDir"
    ];

    for (const key of requiredArtifactKeys) {
      expect(summary.artifacts, `missing artifact key: ${key}`).toHaveProperty(key);
    }
  });

  it("screenshot items have stable shape", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: null,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    const shot = summary.screenshots[0];
    expect(shot).toHaveProperty("name");
    expect(shot).toHaveProperty("path");
    expect(shot).toHaveProperty("url");
    expect(shot).toHaveProperty("fullPage");
  });

  it("performance metrics have stable shape when present", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: null,
      performance: perf,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    const perfData = summary.performance!;
    expect(perfData.metrics).toHaveProperty("performanceScore");
    expect(perfData.metrics).toHaveProperty("lcpMs");
    expect(perfData.metrics).toHaveProperty("cls");
    expect(perfData.metrics).toHaveProperty("tbtMs");
    expect(perfData.budgets).toHaveProperty("performance");
    expect(perfData.budgetResults).toHaveProperty("performance");
  });

  it("a11y data has stable shape when present", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y,
      performance: null,
      visual: null,
      options: { failOnA11y: false, failOnPerf: true, failOnVisual: true }
    });

    const a11yData = summary.a11y!;
    expect(a11yData).toHaveProperty("violations");
    expect(a11yData).toHaveProperty("countsByImpact");
    expect(a11yData.countsByImpact).toHaveProperty("critical");
    expect(a11yData.countsByImpact).toHaveProperty("serious");
    expect(a11yData.countsByImpact).toHaveProperty("moderate");
    expect(a11yData.countsByImpact).toHaveProperty("minor");
    expect(a11yData).toHaveProperty("reportPath");
  });

  it("schemaVersion is semver and stable", () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    // Bump this expectation deliberately when changing the schema
    expect(SCHEMA_VERSION).toBe("1.0.0");
  });
});

describe("markdown output", () => {
  it("produces valid markdown with all sections", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y,
      performance: perf,
      visual,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    const md = formatSummaryAsMarkdown(summary);

    expect(md).toContain("# Web Quality Gatekeeper Report");
    expect(md).toContain("**Status**");
    expect(md).toContain("## Steps");
    expect(md).toContain("| Playwright |");
    expect(md).toContain("## Accessibility");
    expect(md).toContain("## Performance");
    expect(md).toContain("## Visual Regression");
  });

  it("omits sections for null data", () => {
    const summary = buildSummary({
      ...baseParams,
      a11y: null,
      performance: null,
      visual: null,
      options: { failOnA11y: true, failOnPerf: true, failOnVisual: true }
    });

    const md = formatSummaryAsMarkdown(summary);

    expect(md).toContain("# Web Quality Gatekeeper Report");
    expect(md).not.toContain("## Accessibility");
    expect(md).not.toContain("## Performance");
    expect(md).not.toContain("## Visual Regression");
  });
});
