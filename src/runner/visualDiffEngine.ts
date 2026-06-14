import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pixelmatch from "pixelmatch";
import { pathExists } from "../utils/fs.js";
import type { Logger } from "../utils/logger.js";
import {
  buildNativeVisualDiffChildEnv,
  classifyNativeVisualDiffPath,
  isCiEnvironment,
  isNativeVisualEngine,
  isTruthy,
  resolveNativeVisualDiffInvocation
} from "./nativeVisualDiffSupport.js";

const execFileAsync = promisify(execFile);
const DEFAULT_NATIVE_TIMEOUT_MS = 5000;

export type VisualDiffEngineName = "pixelmatch" | "native-rust";
export type ConfiguredVisualDiffEngineName = VisualDiffEngineName | "native-rust-spike";

export interface VisualDiffEngineOptions {
  includeAA: boolean;
  threshold: number;
  logger: Logger;
  engine?: ConfiguredVisualDiffEngineName;
  nativeBinaryPath?: string;
}

export interface VisualDiffComputation {
  diffPixels: number;
  engine: VisualDiffEngineName;
}

interface NativeVisualDiffResult {
  diffPixels?: unknown;
}

function resolveEngine(options: VisualDiffEngineOptions): VisualDiffEngineName {
  const configuredEngine = process.env.WQG_VISUAL_DIFF_ENGINE ?? options.engine;
  return isNativeVisualEngine(configuredEngine) ? "native-rust" : "pixelmatch";
}

function nativeEngineAllowedInCurrentEnvironment(): boolean {
  return !isCiEnvironment() || isTruthy(process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE);
}

function scriptNativeEngineAllowed(): boolean {
  return isTruthy(process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE);
}

function resolveNativeTimeoutMs(): number {
  const raw = process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_NATIVE_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NATIVE_TIMEOUT_MS;
}

function formatNativeFailure(error: unknown, timeoutMs: number): string {
  if (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "ETIMEDOUT") ||
      ("killed" in error &&
        error.killed === true &&
        "signal" in error &&
        typeof error.signal === "string" &&
        error.signal.length > 0))
  ) {
    return `Timed out after ${timeoutMs}ms.`;
  }

  return error instanceof Error ? error.message : String(error);
}

async function runPixelmatch(
  baseline: Uint8Array,
  current: Uint8Array,
  diff: Uint8Array,
  width: number,
  height: number,
  options: VisualDiffEngineOptions
): Promise<VisualDiffComputation> {
  return {
    diffPixels: pixelmatch(baseline, current, diff, width, height, {
      includeAA: options.includeAA,
      threshold: options.threshold
    }),
    engine: "pixelmatch"
  };
}

async function runNativeRust(
  baseline: Uint8Array,
  current: Uint8Array,
  diff: Uint8Array,
  width: number,
  height: number,
  options: VisualDiffEngineOptions
): Promise<VisualDiffComputation | null> {
  const binaryPath = process.env.WQG_VISUAL_DIFF_NATIVE_BIN ?? options.nativeBinaryPath;
  if (!binaryPath || !(await pathExists(binaryPath))) {
    options.logger.warn(
      "Native visual diff engine requested but no executable was provided; falling back to pixelmatch."
    );
    return null;
  }
  const nativePathType = await classifyNativeVisualDiffPath(binaryPath);
  if (nativePathType === "script") {
    options.logger.warn(
      "Native visual diff engine path appears to be a shell, batch, PowerShell, or shebang script; use a reviewed native binary or a JavaScript test adapter. Falling back to pixelmatch."
    );
    return null;
  }
  if (nativePathType === "javascript-adapter" && !scriptNativeEngineAllowed()) {
    options.logger.warn(
      "Native visual diff engine path appears to be a JavaScript adapter; set WQG_ALLOW_SCRIPT_NATIVE_ENGINE=true only for trusted test adapters. Falling back to pixelmatch."
    );
    return null;
  }
  if (!options.includeAA) {
    options.logger.warn(
      "Native visual diff engine does not support anti-aliased pixel suppression yet; set visual.pixelmatch.includeAA=true only when that parity tradeoff is acceptable. Falling back to pixelmatch."
    );
    return null;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-visual-native-"));
  const baselinePath = path.join(tempDir, "baseline.rgba");
  const currentPath = path.join(tempDir, "current.rgba");
  const diffPath = path.join(tempDir, "diff.rgba");
  const timeoutMs = resolveNativeTimeoutMs();
  const invocation = resolveNativeVisualDiffInvocation(binaryPath);

  try {
    await Promise.all([writeFile(baselinePath, baseline), writeFile(currentPath, current)]);
    const { stdout } = await execFileAsync(
      invocation.command,
      [
        ...invocation.args,
        "--width",
        String(width),
        "--height",
        String(height),
        "--baseline",
        baselinePath,
        "--current",
        currentPath,
        "--diff-out",
        diffPath,
        "--threshold",
        String(options.threshold)
      ],
      {
        timeout: timeoutMs,
        env: buildNativeVisualDiffChildEnv()
      }
    );
    const parsed = JSON.parse(stdout.trim()) as NativeVisualDiffResult;
    const diffPixels =
      typeof parsed.diffPixels === "number" ? Math.trunc(parsed.diffPixels) : Number.NaN;
    if (!Number.isFinite(diffPixels) || diffPixels < 0) {
      throw new Error(
        `Native visual diff engine returned invalid diff pixel count: ${stdout.trim()}`
      );
    }

    const nativeDiff = await readFile(diffPath);
    if (nativeDiff.length !== diff.length) {
      throw new Error(
        `Native visual diff engine returned ${nativeDiff.length} diff bytes for ${diff.length} expected bytes.`
      );
    }
    diff.set(nativeDiff);
    return {
      diffPixels,
      engine: "native-rust"
    };
  } catch (error) {
    options.logger.warn(
      `Native visual diff engine failed; falling back to pixelmatch. ${formatNativeFailure(error, timeoutMs)}`
    );
    return null;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function computeVisualDiff(
  baseline: Uint8Array,
  current: Uint8Array,
  diff: Uint8Array,
  width: number,
  height: number,
  options: VisualDiffEngineOptions
): Promise<VisualDiffComputation> {
  const engine = resolveEngine(options);
  if (engine === "native-rust") {
    if (!nativeEngineAllowedInCurrentEnvironment()) {
      options.logger.warn(
        "Native visual diff engine is disabled in CI unless WQG_ALLOW_NATIVE_VISUAL_ENGINE=true; falling back to pixelmatch."
      );
      return runPixelmatch(baseline, current, diff, width, height, options);
    }

    const nativeResult = await runNativeRust(baseline, current, diff, width, height, options);
    if (nativeResult) {
      return nativeResult;
    }
  }

  return runPixelmatch(baseline, current, diff, width, height, options);
}
