import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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
