import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { copyFileSafe, ensureDir, pathExists } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import type { ScreenshotResult } from "./playwright.js";

export type VisualStatus = "baseline_created" | "baseline_updated" | "diffed";

export interface VisualDiffResult {
  name: string;
  currentPath: string;
  baselinePath: string;
  diffPath: string | null;
  mismatchRatio: number | null;
  status: VisualStatus;
}

export interface VisualDiffSummary {
  results: VisualDiffResult[];
  threshold: number;
  failed: boolean;
  maxMismatchRatio: number;
}

function normalizePng(png: PNG, width: number, height: number): PNG {
  const normalized = new PNG({ width, height });
  PNG.bitblt(png, normalized, 0, 0, png.width, png.height, 0, 0);
  return normalized;
}

async function readPng(filePath: string): Promise<PNG> {
  const buffer = await readFile(filePath);
  return PNG.sync.read(buffer);
}

async function writePng(filePath: string, png: PNG): Promise<void> {
  const buffer = PNG.sync.write(png);
  await writeFile(filePath, buffer);
}

export function calculateMismatchRatio(diffPixels: number, width: number, height: number): number {
  if (width === 0 || height === 0) {
    return 0;
  }
  return diffPixels / (width * height);
}

export async function runVisualDiff(
  screenshots: ScreenshotResult[],
  baselineDir: string,
  diffDir: string,
  setBaseline: boolean,
  threshold: number,
  logger: Logger
): Promise<VisualDiffSummary> {
  await ensureDir(baselineDir);
  await ensureDir(diffDir);

  const results: VisualDiffResult[] = [];
  let failed = false;
  let maxMismatchRatio = 0;

  for (const shot of screenshots) {
    const baseName = path.basename(shot.path);
    const baselinePath = path.join(baselineDir, baseName);
    const diffPath = path.join(diffDir, baseName);

    const baselineExists = await pathExists(baselinePath);
    if (!baselineExists || setBaseline) {
      const status: VisualStatus = baselineExists ? "baseline_updated" : "baseline_created";
      logger.debug(`Writing baseline for ${shot.name} (${status})`);
      await copyFileSafe(shot.path, baselinePath);
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

  return {
    results,
    threshold,
    failed,
    maxMismatchRatio
  };
}
