import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  unlink
} from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  validateOutputDirectory,
  validateResolvedPathWithinBase,
  writeJson
} from "../utils/fs.js";

export const OUTPUT_BUNDLE_MANIFEST = ".wqg-output-manifest.json";

const STAGING_MARKER = ".wqg-stage.json";
const RECEIPT_SCHEMA_VERSION = 1;

const ROOT_ARTIFACTS = new Set([
  "summary.json",
  "summary.v2.json",
  "report.html",
  "action-plan.md",
  "pr-risk-ledger.json",
  "pr-risk-ledger.md",
  "axe.json",
  "lighthouse.json"
]);
const ARTIFACT_DIRECTORIES = new Set(["screenshots", "diffs", "pages"]);
const TREND_ARTIFACTS = new Set(["trends/dashboard.html", "trends/history.json"]);
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type BundleStatus = "incomplete" | "complete";

export interface OutputBundleReceipt {
  schemaVersion: number;
  status: BundleStatus;
  runId: string;
  generatedFiles: string[];
}

export interface PreparedOutputBundle {
  stagingDir: string;
  runId: string;
  complete(afterPromotion?: () => Promise<void>): Promise<void>;
  abort(): Promise<void>;
}

function resolveSymlinkAwarePath(targetPath: string): string {
  const resolvedTarget = path.resolve(targetPath);
  const missingSegments: string[] = [];
  let current = resolvedTarget;

  while (true) {
    try {
      const existing = realpathSync.native(current);
      return missingSegments.reduce((value, segment) => path.join(value, segment), existing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return resolvedTarget;
      }
      missingSegments.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isWithin(baseDir: string, targetPath: string): boolean {
  const relativePath = path.relative(baseDir, targetPath);
  return (
    relativePath.length === 0 || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function normalizeOwnedPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("Output bundle receipt contains an invalid generated file path.");
  }
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    throw new Error(`Output bundle receipt contains an absolute generated file path: ${value}`);
  }

  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`Output bundle receipt contains an unsafe generated file path: ${value}`);
  }
  return segments.join("/");
}

function isGeneratedArtifactPath(relativePath: string): boolean {
  if (ROOT_ARTIFACTS.has(relativePath) || TREND_ARTIFACTS.has(relativePath)) {
    return true;
  }
  const [root, ...rest] = relativePath.split("/");
  return ARTIFACT_DIRECTORIES.has(root!) && rest.length > 0;
}

function normalizeReceipt(value: unknown): OutputBundleReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Output bundle receipt must be a JSON object.");
  }
  const candidate = value as Partial<OutputBundleReceipt>;
  if (candidate.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    throw new Error("Output bundle receipt has an unsupported schema version.");
  }
  if (candidate.status !== "incomplete" && candidate.status !== "complete") {
    throw new Error("Output bundle receipt has an invalid status.");
  }
  if (typeof candidate.runId !== "string" || !RUN_ID_PATTERN.test(candidate.runId)) {
    throw new Error("Output bundle receipt has an invalid run ID.");
  }
  if (!Array.isArray(candidate.generatedFiles)) {
    throw new Error("Output bundle receipt must list generated files.");
  }

  const generatedFiles = candidate.generatedFiles.map(normalizeOwnedPath);
  if (new Set(generatedFiles).size !== generatedFiles.length) {
    throw new Error("Output bundle receipt lists duplicate generated files.");
  }
  if (generatedFiles.some((file) => !isGeneratedArtifactPath(file))) {
    throw new Error("Output bundle receipt lists a path outside the generated artifact layout.");
  }

  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    status: candidate.status,
    runId: candidate.runId,
    generatedFiles
  };
}

function resolveRunId(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return randomUUID();
  }
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error(
      "WQG_RUN_ID must contain only letters, numbers, dots, underscores, and hyphens."
    );
  }
  return value;
}

async function lstatOrNull(targetPath: string) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function ownedPath(outDir: string, relativePath: string): string {
  const normalized = normalizeOwnedPath(relativePath);
  if (!isGeneratedArtifactPath(normalized)) {
    throw new Error(`Path is not a generated WQG artifact: ${relativePath}`);
  }
  const targetPath = path.join(outDir, ...normalized.split("/"));
  validateResolvedPathWithinBase(targetPath, outDir);
  return targetPath;
}

async function assertRegularFileOrMissing(targetPath: string, outDir: string): Promise<void> {
  validateResolvedPathWithinBase(targetPath, outDir);
  const metadata = await lstatOrNull(targetPath);
  if (!metadata) {
    return;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Refusing to modify symbolic link in generated artifact path: ${targetPath}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Refusing to modify non-file generated artifact path: ${targetPath}`);
  }
}

async function assertPromotableDestination(
  targetPath: string,
  outDir: string,
  previouslyOwned: Set<string>,
  relativePath: string
): Promise<void> {
  validateResolvedPathWithinBase(targetPath, outDir);
  const metadata = await lstatOrNull(targetPath);
  if (!metadata) {
    return;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Refusing to modify symbolic link in generated artifact path: ${targetPath}`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Refusing to modify non-file generated artifact path: ${targetPath}`);
  }
  if (!previouslyOwned.has(relativePath)) {
    throw new Error(`Refusing to overwrite unowned file in generated artifact path: ${targetPath}`);
  }
}

async function readReceipt(outDir: string): Promise<OutputBundleReceipt | null> {
  const receiptPath = path.join(outDir, OUTPUT_BUNDLE_MANIFEST);
  validateResolvedPathWithinBase(receiptPath, outDir);
  const metadata = await lstatOrNull(receiptPath);
  if (!metadata) {
    return null;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Output bundle receipt must be a regular file.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(receiptPath, "utf8")) as unknown;
  } catch {
    throw new Error("Output bundle receipt is unreadable or invalid JSON.");
  }
  return normalizeReceipt(parsed);
}

async function writeReceipt(outDir: string, receipt: OutputBundleReceipt): Promise<void> {
  const receiptPath = path.join(outDir, OUTPUT_BUNDLE_MANIFEST);
  validateResolvedPathWithinBase(receiptPath, outDir);
  const existing = await lstatOrNull(receiptPath);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new Error("Refusing to replace a non-file output bundle receipt.");
  }
  await writeJson(receiptPath, receipt);
}

async function findLegacyGeneratedPaths(outDir: string): Promise<string[]> {
  const entries = await readdir(outDir, { withFileTypes: true });
  return entries
    .filter((entry) => {
      if (entry.name === OUTPUT_BUNDLE_MANIFEST || entry.name.startsWith(stagingPrefix(outDir))) {
        return false;
      }
      return (
        ROOT_ARTIFACTS.has(entry.name) ||
        ARTIFACT_DIRECTORIES.has(entry.name) ||
        entry.name === "trends"
      );
    })
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function stageMarkerPath(stagingDir: string): string {
  return path.join(stagingDir, STAGING_MARKER);
}

function stagingPrefix(outDir: string): string {
  return `.${path.basename(outDir)}.wqg-staging-`;
}

function lockPath(outDir: string): string {
  return path.join(path.dirname(outDir), `.${path.basename(outDir)}.wqg-output.lock`);
}

function validateStagingPath(outDir: string, stagingDir: string): void {
  validateOutputDirectory(stagingDir);
  const stagingParent = path.dirname(outDir);
  validateResolvedPathWithinBase(stagingDir, stagingParent);
  if (!path.basename(stagingDir).startsWith(stagingPrefix(outDir))) {
    throw new Error(`Refusing to operate on an unexpected staging directory: ${stagingDir}`);
  }
}

async function removeOwnedStagingDirectory(outDir: string, stagingDir: string): Promise<void> {
  validateStagingPath(outDir, stagingDir);
  const metadata = await lstatOrNull(stagingDir);
  if (!metadata) {
    return;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing to remove unexpected staging path: ${stagingDir}`);
  }
  const markerPath = stageMarkerPath(stagingDir);
  validateResolvedPathWithinBase(markerPath, stagingDir);
  const markerMetadata = await lstatOrNull(markerPath);
  if (!markerMetadata || markerMetadata.isSymbolicLink() || !markerMetadata.isFile()) {
    throw new Error(`Refusing to remove unowned staging directory: ${stagingDir}`);
  }
  let marker: unknown;
  try {
    marker = JSON.parse(await readFile(markerPath, "utf8")) as unknown;
  } catch {
    throw new Error(
      `Refusing to remove staging directory with an invalid ownership marker: ${stagingDir}`
    );
  }
  const normalized = normalizeReceipt(marker);
  if (normalized.status !== "incomplete" || normalized.generatedFiles.length !== 0) {
    throw new Error(
      `Refusing to remove staging directory with an invalid ownership marker: ${stagingDir}`
    );
  }
  await rm(stagingDir, { recursive: true, force: false });
}

async function clearPreviousStaging(outDir: string): Promise<void> {
  const stagingParent = path.dirname(outDir);
  const entries = await readdir(stagingParent, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.startsWith(stagingPrefix(outDir))) {
      continue;
    }
    await removeOwnedStagingDirectory(outDir, path.join(stagingParent, entry.name));
  }
}

async function createStagingDirectory(outDir: string, runId: string): Promise<string> {
  const stagingTemplate = path.join(path.dirname(outDir), stagingPrefix(outDir));
  validateOutputDirectory(stagingTemplate);
  const stagingDir = await mkdtemp(stagingTemplate);
  validateStagingPath(outDir, stagingDir);
  await writeJson(stageMarkerPath(stagingDir), {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    status: "incomplete",
    runId,
    generatedFiles: []
  } satisfies OutputBundleReceipt);
  return stagingDir;
}

async function acquireOutputLock(outDir: string, runId: string): Promise<() => Promise<void>> {
  const outputLockPath = lockPath(outDir);
  const lockParent = path.dirname(outDir);
  validateOutputDirectory(outputLockPath);
  validateResolvedPathWithinBase(outputLockPath, lockParent);
  let handle;
  try {
    handle = await open(outputLockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`An audit already owns this output directory: ${outDir}`, { cause: error });
    }
    throw error;
  }
  try {
    await handle.writeFile(`${runId}\n`, "utf8");
  } catch (error) {
    await handle.close();
    await unlink(outputLockPath).catch(() => undefined);
    throw error;
  }

  let released = false;
  return async (): Promise<void> => {
    if (released) {
      return;
    }
    await handle.close();
    await unlink(outputLockPath);
    released = true;
  };
}

async function collectStagedFiles(stagingDir: string, currentDir = stagingDir): Promise<string[]> {
  validateResolvedPathWithinBase(currentDir, stagingDir);
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const candidatePath = path.join(currentDir, entry.name);
    validateResolvedPathWithinBase(candidatePath, stagingDir);
    const metadata = await lstat(candidatePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing to promote symbolic link from staging: ${candidatePath}`);
    }
    if (metadata.isDirectory()) {
      files.push(...(await collectStagedFiles(stagingDir, candidatePath)));
      continue;
    }
    if (!metadata.isFile()) {
      throw new Error(`Refusing to promote non-file staging artifact: ${candidatePath}`);
    }
    const relativePath = normalizeOwnedPath(path.relative(stagingDir, candidatePath));
    if (relativePath === STAGING_MARKER) {
      continue;
    }
    if (!isGeneratedArtifactPath(relativePath)) {
      throw new Error(`Staging produced an unrecognized artifact path: ${relativePath}`);
    }
    files.push(relativePath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function promoteStagedFiles(
  outDir: string,
  stagingDir: string,
  previousGeneratedFiles: string[],
  currentGeneratedFiles: string[]
): Promise<void> {
  const currentSet = new Set(currentGeneratedFiles);

  for (const relativePath of currentGeneratedFiles) {
    const sourcePath = path.join(stagingDir, ...relativePath.split("/"));
    validateResolvedPathWithinBase(sourcePath, stagingDir);
    const sourceMetadata = await lstat(sourcePath);
    if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
      throw new Error(`Refusing to promote unsafe staging artifact: ${sourcePath}`);
    }

    const destinationPath = ownedPath(outDir, relativePath);
    validateResolvedPathWithinBase(destinationPath, outDir);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  for (const relativePath of previousGeneratedFiles) {
    if (currentSet.has(relativePath)) {
      continue;
    }
    const destinationPath = ownedPath(outDir, relativePath);
    await assertRegularFileOrMissing(destinationPath, outDir);
    if (await lstatOrNull(destinationPath)) {
      await rm(destinationPath, { force: false });
    }
  }
}

async function validatePromotion(
  outDir: string,
  stagingDir: string,
  previousGeneratedFiles: string[],
  currentGeneratedFiles: string[]
): Promise<void> {
  const previousSet = new Set(previousGeneratedFiles);
  for (const relativePath of currentGeneratedFiles) {
    const sourcePath = path.join(stagingDir, ...relativePath.split("/"));
    validateResolvedPathWithinBase(sourcePath, stagingDir);
    const sourceMetadata = await lstat(sourcePath);
    if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
      throw new Error(`Refusing to promote unsafe staging artifact: ${sourcePath}`);
    }
    const destinationPath = ownedPath(outDir, relativePath);
    await assertPromotableDestination(destinationPath, outDir, previousSet, relativePath);
  }
}

/**
 * Rejects a baseline or trend-history directory that could collide with files
 * WQG owns in an output bundle. A nested directory with a different first path
 * segment remains supported.
 */
export function validatePreservedOutputDirectory(
  outDir: string,
  preservedDir: string,
  label: string
): void {
  const resolvedOutDir = resolveSymlinkAwarePath(outDir);
  const resolvedPreservedDir = resolveSymlinkAwarePath(preservedDir);

  if (resolvedOutDir === resolvedPreservedDir) {
    throw new Error(`${label} cannot be the same directory as the audit output.`);
  }
  if (label === "Baseline directory") {
    if (
      isWithin(resolvedPreservedDir, resolvedOutDir) ||
      isWithin(resolvedOutDir, resolvedPreservedDir)
    ) {
      throw new Error(`${label} cannot overlap the audit output directory.`);
    }
    return;
  }
  if (isWithin(resolvedPreservedDir, resolvedOutDir)) {
    throw new Error(`${label} cannot contain the audit output directory.`);
  }
  if (isWithin(resolvedOutDir, resolvedPreservedDir)) {
    const relativePath = path.relative(resolvedOutDir, resolvedPreservedDir);
    const [firstSegment] = relativePath.split(path.sep);
    if (
      ROOT_ARTIFACTS.has(firstSegment!) ||
      ARTIFACT_DIRECTORIES.has(firstSegment!) ||
      firstSegment === "trends" ||
      firstSegment === OUTPUT_BUNDLE_MANIFEST
    ) {
      throw new Error(`${label} overlaps a generated WQG artifact path: ${preservedDir}`);
    }
  }
}

/**
 * Creates a run-scoped staging bundle and leaves a matching incomplete receipt
 * in the public output directory until every generated file is promoted.
 */
export async function prepareOutputBundle(
  outDir: string,
  requestedRunId: string | undefined = process.env.WQG_RUN_ID
): Promise<PreparedOutputBundle> {
  validateOutputDirectory(outDir);
  const canonicalOutDir = resolveSymlinkAwarePath(outDir);
  validateOutputDirectory(canonicalOutDir);
  await ensureDir(canonicalOutDir);
  validateResolvedPathWithinBase(canonicalOutDir, canonicalOutDir);
  const runId = resolveRunId(requestedRunId);
  const releaseLock = await acquireOutputLock(canonicalOutDir, runId);
  try {
    await clearPreviousStaging(canonicalOutDir);
    const previousReceipt = await readReceipt(canonicalOutDir);
    if (!previousReceipt) {
      const legacyPaths = await findLegacyGeneratedPaths(canonicalOutDir);
      if (legacyPaths.length > 0) {
        throw new Error(
          `Output directory contains legacy WQG artifacts without ${OUTPUT_BUNDLE_MANIFEST}: ${legacyPaths.join(
            ", "
          )}. Use a fresh output directory or remove them after review.`
        );
      }
    }

    const previousGeneratedFiles = previousReceipt?.generatedFiles ?? [];
    await writeReceipt(canonicalOutDir, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      status: "incomplete",
      runId,
      generatedFiles: previousGeneratedFiles
    });
    const stagingDir = await createStagingDirectory(canonicalOutDir, runId);

    let settled = false;
    return {
      stagingDir,
      runId,
      async complete(afterPromotion?: () => Promise<void>): Promise<void> {
        if (settled) {
          throw new Error("Output bundle has already been finalized.");
        }
        const generatedFiles = await collectStagedFiles(stagingDir);
        await validatePromotion(
          canonicalOutDir,
          stagingDir,
          previousGeneratedFiles,
          generatedFiles
        );
        const recoveryFiles = Array.from(
          new Set([...previousGeneratedFiles, ...generatedFiles])
        ).sort((left, right) => left.localeCompare(right));
        await writeReceipt(canonicalOutDir, {
          schemaVersion: RECEIPT_SCHEMA_VERSION,
          status: "incomplete",
          runId,
          generatedFiles: recoveryFiles
        });
        await promoteStagedFiles(canonicalOutDir, stagingDir, recoveryFiles, generatedFiles);
        if (afterPromotion) {
          await afterPromotion();
        }
        await removeOwnedStagingDirectory(canonicalOutDir, stagingDir);
        await writeReceipt(canonicalOutDir, {
          schemaVersion: RECEIPT_SCHEMA_VERSION,
          status: "complete",
          runId,
          generatedFiles
        });
        settled = true;
        await releaseLock();
      },
      async abort(): Promise<void> {
        if (settled) {
          return;
        }
        try {
          await removeOwnedStagingDirectory(canonicalOutDir, stagingDir);
        } finally {
          settled = true;
          await releaseLock();
        }
      }
    };
  } catch (error) {
    await releaseLock().catch(() => undefined);
    throw error;
  }
}
