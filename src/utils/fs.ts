import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { copyFile, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function resolveExistingPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function resolveSymlinkAwarePath(targetPath: string): string {
  const resolvedTarget = resolve(targetPath);
  const missingSegments: string[] = [];
  let current = resolvedTarget;

  while (true) {
    try {
      const existingPath = realpathSync.native(current);
      return missingSegments.reduce((acc, segment) => join(acc, segment), existingPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw err;
      }

      const parent = dirname(current);
      if (parent === current) {
        return resolvedTarget;
      }
      missingSegments.unshift(basename(current));
      current = parent;
    }
  }
}

/**
 * Validates that a target path is safely within a base directory.
 * Prevents path traversal attacks (e.g., ../../../etc/passwd).
 */
export function validatePathWithinBase(targetPath: string, baseDir: string): void {
  const resolvedTarget = resolve(targetPath);
  const resolvedBase = resolve(baseDir);
  const relativePath = relative(resolvedBase, resolvedTarget);
  
  // If the relative path starts with ".." or is absolute, it escapes the base
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Path traversal detected: ${targetPath} is outside ${baseDir}`);
  }
}

/**
 * Validates that an output directory is within the current working directory.
 * Prevents writing to arbitrary system locations.
 */
export function validateOutputDirectory(outDir: string): void {
  const cwd = process.cwd();
  const resolvedOut = resolveSymlinkAwarePath(outDir);
  const allowedBases = [cwd];
  if (process.env.GITHUB_WORKSPACE) {
    allowedBases.push(process.env.GITHUB_WORKSPACE);
  }

  const isAllowed = allowedBases.some((base) => {
    const relativePath = relative(resolveExistingPath(base), resolvedOut);
    return !relativePath.startsWith("..") && !isAbsolute(relativePath);
  });

  if (!isAllowed) {
    throw new Error(
      `Output directory must be within the working directory or GITHUB_WORKSPACE: ${outDir}`
    );
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  const outputDir = dirname(path);
  await ensureDir(outputDir);

  const tempPath = join(outputDir, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Best effort cleanup only.
    }
    throw error;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFileAtomic(path, content);
}

export async function writeText(path: string, content: string): Promise<void> {
  await writeFileAtomic(path, content);
}

export async function copyFileSafe(source: string, destination: string): Promise<void> {
  await ensureDir(dirname(destination));
  await copyFile(source, destination);
}
