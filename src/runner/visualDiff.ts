import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
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

  // Security: Load existing manifest for integrity verification
  const manifest = await loadManifest(baselineDir);
  const newChecksums: Record<string, string> = {};

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

    // Preserve existing checksum
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

  // Security: Save updated manifest with checksums
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
