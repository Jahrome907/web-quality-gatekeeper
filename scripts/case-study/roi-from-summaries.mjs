#!/usr/bin/env node
/* global console, process */
import { readFileSync } from "node:fs";

function usage() {
  console.error("Usage: node scripts/case-study/roi-from-summaries.mjs <baseline-summary-v2.json> <improved-summary-v2.json>");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function toNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toFiniteNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values) {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return Number((total / values.length).toFixed(4));
}

function extract(summary) {
  const rollup = summary?.rollup ?? {};
  const pages = Array.isArray(summary?.pages) ? summary.pages : [];
  const performanceScores = [];
  const lcpValues = [];

  for (const page of pages) {
    const metrics = page?.details?.performance?.metrics ?? {};
    const performanceScore = toFiniteNumberOrNull(metrics.performanceScore);
    const lcpMs = toFiniteNumberOrNull(metrics.lcpMs);
    if (performanceScore !== null) {
      performanceScores.push(performanceScore);
    }
    if (lcpMs !== null) {
      lcpValues.push(lcpMs);
    }
  }

  return {
    overallStatus: String(summary?.overallStatus ?? "unknown"),
    failedPages: toNumber(rollup.failedPages),
    a11yViolations: toNumber(rollup.a11yViolations),
    performanceBudgetFailures: toNumber(rollup.performanceBudgetFailures),
    visualFailures: toNumber(rollup.visualFailures),
    performanceScore: average(performanceScores),
    lcpMs: average(lcpValues)
  };
}

function delta(current, previous) {
  if (current === null || previous === null) {
    return null;
  }
  return Number((current - previous).toFixed(4));
}

const [baselinePath, improvedPath] = process.argv.slice(2);
if (!baselinePath || !improvedPath) {
  usage();
  process.exit(2);
}

const baseline = extract(readJson(baselinePath));
const improved = extract(readJson(improvedPath));

const output = {
  baseline,
  improved,
  roi: {
    a11yViolationsDelta: delta(improved.a11yViolations, baseline.a11yViolations),
    performanceScoreDelta: delta(improved.performanceScore, baseline.performanceScore),
    lcpMsDelta: delta(improved.lcpMs, baseline.lcpMs),
    visualFailuresDelta: delta(improved.visualFailures, baseline.visualFailures),
    failedPagesDelta: delta(improved.failedPages, baseline.failedPages)
  }
};

console.log(JSON.stringify(output, null, 2));
