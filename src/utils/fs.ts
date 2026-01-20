import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";

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
  const resolvedOut = resolve(outDir);
  const relativePath = relative(cwd, resolvedOut);
  
  // Allow paths within cwd or explicit absolute paths that don't traverse up from cwd
  if (relativePath.startsWith("..")) {
    throw new Error(`Output directory must be within the working directory: ${outDir}`);
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

export async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const content = JSON.stringify(data, null, 2);
  await writeFile(path, content, "utf8");
}

export async function writeText(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

export async function copyFileSafe(source: string, destination: string): Promise<void> {
  await ensureDir(dirname(destination));
  await copyFile(source, destination);
}
