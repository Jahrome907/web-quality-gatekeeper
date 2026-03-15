#!/usr/bin/env node
/* global console, process */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { ROOT } from "../ci/_shared.mjs";

const REQUIRED_FLAGS = [
  "repo-url",
  "baseline-sha",
  "improved-sha",
  "baseline-summary",
  "improved-summary",
  "baseline-report",
  "improved-report",
  "roi-output",
  "config",
  "out"
];

function usage() {
  console.error(
    "Usage: node scripts/case-study/write-provenance-manifest.mjs " +
      "--repo-url <url> --baseline-sha <sha> --improved-sha <sha> " +
      "--baseline-summary <path> --improved-summary <path> " +
      "--baseline-report <path> --improved-report <path> " +
      "--roi-output <path> --config <path> --out <path> " +
      "[--baseline-command <cmd>] [--improved-command <cmd>]"
  );
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unknown argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }

    parsed[key] = value;
    index += 1;
  }

  REQUIRED_FLAGS.forEach((flag) => {
    if (!parsed[flag]) {
      throw new Error(`Missing required flag: --${flag}`);
    }
  });

  return parsed;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(path.resolve(ROOT, filePath), "utf8"));
}

function requireExistingFile(filePath, flagName) {
  const resolved = path.resolve(ROOT, filePath);
  if (!existsSync(resolved)) {
    throw new Error(`Missing file for --${flagName}: ${filePath}`);
  }
  return resolved;
}

function summarizeRun(summary, sha, summaryPath, reportPath, command) {
  return {
    sha,
    summaryPath,
    reportPath,
    command: command ?? null,
    overallStatus: String(summary?.overallStatus ?? "unknown"),
    primaryUrl: String(summary?.primaryUrl ?? summary?.url ?? ""),
    pageCount: Number(summary?.rollup?.pageCount ?? 0),
    failedPages: Number(summary?.rollup?.failedPages ?? 0),
    a11yViolations: Number(summary?.rollup?.a11yViolations ?? 0),
    performanceBudgetFailures: Number(summary?.rollup?.performanceBudgetFailures ?? 0),
    visualFailures: Number(summary?.rollup?.visualFailures ?? 0)
  };
}

const options = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    usage();
    console.error((error).message);
    process.exit(2);
  }
})();

try {
  requireExistingFile(options["baseline-summary"], "baseline-summary");
  requireExistingFile(options["improved-summary"], "improved-summary");
  requireExistingFile(options["baseline-report"], "baseline-report");
  requireExistingFile(options["improved-report"], "improved-report");
  requireExistingFile(options["roi-output"], "roi-output");
  requireExistingFile(options.config, "config");
} catch (error) {
  usage();
  console.error((error).message);
  process.exit(2);
}

const baselineSummary = readJson(options["baseline-summary"]);
const improvedSummary = readJson(options["improved-summary"]);
const roiOutput = readJson(options["roi-output"]);

const manifest = {
  schemaVersion: "1.0.0",
  kind: "public-oss-case-study-provenance",
  generatedAt: new Date().toISOString(),
  repoUrl: options["repo-url"],
  configPath: options.config,
  baseline: summarizeRun(
    baselineSummary,
    options["baseline-sha"],
    options["baseline-summary"],
    options["baseline-report"],
    options["baseline-command"]
  ),
  improved: summarizeRun(
    improvedSummary,
    options["improved-sha"],
    options["improved-summary"],
    options["improved-report"],
    options["improved-command"]
  ),
  roiOutput: {
    path: options["roi-output"],
    deltas: roiOutput.roi ?? null
  }
};

const outputPath = path.resolve(ROOT, options.out);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`Wrote provenance manifest: ${path.relative(ROOT, outputPath)}`);
