import { open } from "node:fs/promises";
import path from "node:path";

export const JAVASCRIPT_NATIVE_ADAPTER_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

const NON_JAVASCRIPT_SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".cmd", ".bat", ".ps1"]);

export type NativeVisualDiffPathType = "javascript-adapter" | "script" | "native";

export function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(`${value ?? ""}`.toLowerCase());
}

export function isCiEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthy(env.CI) || isTruthy(env.GITHUB_ACTIONS);
}

export function isNativeVisualEngine(value: string | undefined): boolean {
  return value === "native-rust" || value === "native-rust-spike";
}

export function resolveNativeVisualDiffInvocation(binaryPath: string): {
  command: string;
  args: string[];
} {
  if (JAVASCRIPT_NATIVE_ADAPTER_EXTENSIONS.has(path.extname(binaryPath).toLowerCase())) {
    return {
      command: process.execPath,
      args: [binaryPath]
    };
  }

  return {
    command: binaryPath,
    args: []
  };
}

export async function classifyNativeVisualDiffPath(
  binaryPath: string
): Promise<NativeVisualDiffPathType> {
  const extension = path.extname(binaryPath).toLowerCase();
  if (JAVASCRIPT_NATIVE_ADAPTER_EXTENSIONS.has(extension)) {
    return "javascript-adapter";
  }
  if (NON_JAVASCRIPT_SCRIPT_EXTENSIONS.has(extension)) {
    return "script";
  }

  let handle;
  try {
    handle = await open(binaryPath, "r");
    const header = Buffer.alloc(2);
    const { bytesRead } = await handle.read(header, 0, 2, 0);
    return bytesRead === 2 && header.toString("utf8") === "#!" ? "script" : "native";
  } catch {
    return "native";
  } finally {
    await handle?.close();
  }
}

export function buildNativeVisualDiffChildEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "HOME",
    "USERPROFILE"
  ];
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of allowedKeys) {
    const value = env[key];
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }
  return childEnv;
}
