/* global Buffer, console, process */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const NATIVE_VISUAL_DIFF_SMOKE_TIMEOUT_MS = 10000;
const JAVASCRIPT_NATIVE_ADAPTER_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const SCRIPT_EXTENSIONS = new Set([".sh", ".bash", ".cmd", ".bat", ".ps1"]);

function resolveBinaryPath(root) {
  const configuredBinaryPath = process.env.WQG_VISUAL_DIFF_NATIVE_BIN?.trim();
  if (configuredBinaryPath) {
    return path.resolve(root, configuredBinaryPath);
  }

  const binaryName =
    process.platform === "win32" ? "wqg-visual-diff-native.exe" : "wqg-visual-diff-native";
  return path.join(
    root,
    "native",
    "wqg-visual-diff-native",
    "target",
    "release",
    binaryName
  );
}

export function classifyNativeSmokeBinaryPath(binaryPath) {
  const extension = path.extname(binaryPath).toLowerCase();
  if (JAVASCRIPT_NATIVE_ADAPTER_EXTENSIONS.has(extension)) {
    return "javascript-adapter";
  }
  if (SCRIPT_EXTENSIONS.has(extension)) {
    return "script";
  }

  let fd = null;
  try {
    fd = openSync(binaryPath, "r");
    const header = Buffer.alloc(2);
    const bytesRead = readSync(fd, header, 0, 2, 0);
    return bytesRead === 2 && header.toString("utf8") === "#!" ? "script" : "native";
  } catch {
    return "native";
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

export function assertNativeSmokeBinaryPath(binaryPath) {
  const pathType = classifyNativeSmokeBinaryPath(binaryPath);
  if (pathType === "javascript-adapter") {
    throw new Error(
      "Native visual diff smoke requires a reviewed native binary; JavaScript adapter paths are not allowed."
    );
  }
  if (pathType === "script") {
    throw new Error(
      "Native visual diff smoke requires a reviewed native binary; shell, batch, PowerShell, and shebang script paths are not allowed."
    );
  }
}

export function runNativeVisualDiffSmoke() {
  const root = process.cwd();
  const binaryPath = resolveBinaryPath(root);

  if (!existsSync(binaryPath)) {
    throw new Error(`Native visual diff binary was not built: ${binaryPath}`);
  }
  assertNativeSmokeBinaryPath(binaryPath);

  const tempDir = mkdtempSync(path.join(tmpdir(), "wqg-native-smoke-"));
  try {
    const baselinePath = path.join(tempDir, "baseline.rgba");
    const currentPath = path.join(tempDir, "current.rgba");
    const diffPath = path.join(tempDir, "diff.rgba");
    const baseline = Buffer.from([
      255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ]);
    const current = Buffer.from(baseline);
    current[0] = 0;
    baseline.set([0, 0, 0, 0], 4);
    current.set([255, 0, 0, 0], 4);
    baseline.set([0, 50, 200, 0], 8);
    current.set([0, 100, 20, 17], 8);

    writeFileSync(baselinePath, baseline);
    writeFileSync(currentPath, current);

    const result = spawnSync(
      binaryPath,
      [
        "--width",
        "2",
        "--height",
        "2",
        "--baseline",
        baselinePath,
        "--current",
        currentPath,
        "--diff-out",
        diffPath,
        "--threshold",
        "0.02"
      ],
      {
        encoding: "utf8",
        timeout: NATIVE_VISUAL_DIFF_SMOKE_TIMEOUT_MS
      }
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      throw new Error(
        `Native visual diff smoke failed with exit ${result.status}: ${result.stderr || result.stdout}`
      );
    }

    const parsed = JSON.parse(result.stdout);
    if (parsed.diffPixels !== 1 || parsed.pixelCount !== 4) {
      throw new Error(`Unexpected native visual diff smoke output: ${result.stdout}`);
    }
    if (readFileSync(diffPath).length !== baseline.length) {
      throw new Error("Native visual diff smoke wrote a diff buffer with the wrong length.");
    }

    console.log("Native visual diff smoke completed.");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runNativeVisualDiffSmoke();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
