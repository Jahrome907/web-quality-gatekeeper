import path from "node:path";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { DEFAULT_PIXELMATCH_INCLUDE_AA, DEFAULT_PIXELMATCH_THRESHOLD } from "../config/schema.js";
import { copyFileSafe, ensureDir, pathExists, writeJson } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import type { ScreenshotResult } from "./playwright.js";

// Security: Baseline manifest for integrity verification
interface BaselineManifest {
  version: 1;
  generatedAt: string;
  checksums: Record<string, string>;
}

const MANIFEST_FILENAME = "baseline-manifest.json";

function computeSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function loadManifest(baselineDir: string): Promise<BaselineManifest | null> {
  const manifestPath = path.join(baselineDir, MANIFEST_FILENAME);
  if (!(await pathExists(manifestPath))) {
    return null;
  }
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw) as BaselineManifest;
  } catch {
    return null;
  }
}

async function saveManifest(baselineDir: string, checksums: Record<string, string>): Promise<void> {
  const manifest: BaselineManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    checksums
  };
  await writeJson(path.join(baselineDir, MANIFEST_FILENAME), manifest);
}

function checksumsSignature(checksums: Record<string, string>): string {
  const entries = Object.entries(checksums).sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(entries);
}

async function verifyBaselineIntegrity(
  baselinePath: string,
  expectedHash: string | undefined,
  logger: Logger
): Promise<boolean> {
  if (!expectedHash) {
    return true; // No hash to verify against
  }
  const buffer = await readFile(baselinePath);
  const actualHash = computeSha256(buffer);
  if (actualHash !== expectedHash) {
    logger.warn(
      `Baseline integrity check failed for ${path.basename(baselinePath)}. ` +
        `Expected: ${expectedHash.slice(0, 12)}..., Got: ${actualHash.slice(0, 12)}...`
    );
    return false;
  }
  return true;
}

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

export interface PixelmatchRuntimeOptions {
  includeAA: boolean;
  threshold: number;
}

export interface VisualIgnoreRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualDiffRuntimeOptions {
  pixelmatch?: Partial<PixelmatchRuntimeOptions>;
  ignoreRegions?: VisualIgnoreRegion[];
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

export function calculateMismatchRatio(
  diffPixels: number,
  width: number,
  height: number,
  ignoredPixels: number = 0
): number {
  const totalPixels = width * height;
  const comparablePixels = Math.max(0, totalPixels - ignoredPixels);
  if (comparablePixels === 0) {
    return 0;
  }
  return diffPixels / comparablePixels;
}

interface ClippedRegion {
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

function clipRegion(region: VisualIgnoreRegion, width: number, height: number): ClippedRegion | null {
  const startX = Math.max(0, Math.min(width, region.x));
  const startY = Math.max(0, Math.min(height, region.y));
  const endX = Math.max(0, Math.min(width, region.x + region.width));
  const endY = Math.max(0, Math.min(height, region.y + region.height));
  if (startX >= endX || startY >= endY) {
    return null;
  }
  return { startX, endX, startY, endY };
}

function applyIgnoreRegionsMask(
  baseline: PNG,
  current: PNG,
  diff: PNG,
  regions: VisualIgnoreRegion[]
): number {
  if (regions.length === 0) {
    return 0;
  }

  const width = baseline.width;
  const height = baseline.height;
  const masked = new Uint8Array(width * height);
  let maskedPixels = 0;

  for (const region of regions) {
    const clipped = clipRegion(region, width, height);
    if (!clipped) {
      continue;
    }

    for (let y = clipped.startY; y < clipped.endY; y += 1) {
      for (let x = clipped.startX; x < clipped.endX; x += 1) {
        const pixelIndex = y * width + x;
        if (masked[pixelIndex] === 1) {
          continue;
        }
        masked[pixelIndex] = 1;
        maskedPixels += 1;

        const byteIndex = pixelIndex * 4;
        current.data[byteIndex] = baseline.data[byteIndex] ?? 0;
        current.data[byteIndex + 1] = baseline.data[byteIndex + 1] ?? 0;
        current.data[byteIndex + 2] = baseline.data[byteIndex + 2] ?? 0;
        current.data[byteIndex + 3] = baseline.data[byteIndex + 3] ?? 0;
        diff.data[byteIndex] = 0;
        diff.data[byteIndex + 1] = 0;
        diff.data[byteIndex + 2] = 0;
        diff.data[byteIndex + 3] = 0;
      }
    }
  }

  return maskedPixels;
}

export async function runVisualDiff(
  screenshots: ScreenshotResult[],
  baselineDir: string,
  diffDir: string,
  setBaseline: boolean,
  threshold: number,
  logger: Logger,
  options: VisualDiffRuntimeOptions = {}
): Promise<VisualDiffSummary> {
  await ensureDir(baselineDir);
  await ensureDir(diffDir);

  const pixelmatchIncludeAA = options.pixelmatch?.includeAA ?? DEFAULT_PIXELMATCH_INCLUDE_AA;
  const pixelmatchThreshold = options.pixelmatch?.threshold ?? DEFAULT_PIXELMATCH_THRESHOLD;
  const ignoreRegions = options.ignoreRegions ?? [];

  // Security: Load existing manifest for integrity verification and backfill.
  const manifest = await loadManifest(baselineDir);
  const existingChecksums = manifest?.checksums ?? {};
  const newChecksums: Record<string, string> = { ...existingChecksums };
  let backfilledChecksums = 0;

  const baselineFiles = await readdir(baselineDir);
  for (const fileName of baselineFiles) {
    if (!fileName.toLowerCase().endsWith(".png")) {
      continue;
    }
    if (newChecksums[fileName]) {
      continue;
    }
    const baselinePath = path.join(baselineDir, fileName);
    if (!(await pathExists(baselinePath))) {
      continue;
    }
    const buffer = await readFile(baselinePath);
    newChecksums[fileName] = computeSha256(buffer);
    backfilledChecksums += 1;
  }

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

      // Compute and store checksum for new baseline
      const buffer = await readFile(baselinePath);
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

    // Security: Verify baseline integrity before comparison
    const expectedHash = newChecksums[baseName];
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

    if (!expectedHash) {
      const buffer = await readFile(baselinePath);
      newChecksums[baseName] = computeSha256(buffer);
      backfilledChecksums += 1;
    }

    const currentPng = await readPng(shot.path);
    const baselinePng = await readPng(baselinePath);
    const width = Math.max(currentPng.width, baselinePng.width);
    const height = Math.max(currentPng.height, baselinePng.height);
    const currentNormalized = normalizePng(currentPng, width, height);
    const baselineNormalized = normalizePng(baselinePng, width, height);
    const diff = new PNG({ width, height });
    const ignoredPixels = applyIgnoreRegionsMask(
      baselineNormalized,
      currentNormalized,
      diff,
      ignoreRegions
    );

    const diffPixels = pixelmatch(
      baselineNormalized.data,
      currentNormalized.data,
      diff.data,
      width,
      height,
      { includeAA: pixelmatchIncludeAA, threshold: pixelmatchThreshold }
    );

    const mismatchRatio = calculateMismatchRatio(diffPixels, width, height, ignoredPixels);
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

  for (const [fileName] of Object.entries(newChecksums)) {
    const baselinePath = path.join(baselineDir, fileName);
    if (!(await pathExists(baselinePath))) {
      delete newChecksums[fileName];
    }
  }

  // Security: Save updated manifest with checksums only if changes were detected.
  const changed = checksumsSignature(existingChecksums) !== checksumsSignature(newChecksums);
  if (Object.keys(newChecksums).length > 0 && changed) {
    await saveManifest(baselineDir, newChecksums);
    logger.debug(
      `Updated baseline integrity manifest with ${Object.keys(newChecksums).length} checksums` +
        (backfilledChecksums > 0 ? ` (${backfilledChecksums} backfilled)` : "")
    );
  }

  return {
    results,
    threshold,
    failed,
    maxMismatchRatio
  };
}
