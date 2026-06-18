import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "./config/loadConfig.js";
import type { Config } from "./config/schema.js";
import { validateOutputDirectory } from "./utils/fs.js";
import {
  buildNativeVisualDiffChildEnv,
  classifyNativeVisualDiffPath,
  isCiEnvironment,
  isNativeVisualEngine,
  isTruthy,
  resolveNativeVisualDiffInvocation
} from "./runner/nativeVisualDiffSupport.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  version: string;
  engines?: { node?: string };
};
const NATIVE_PROBE_TIMEOUT_MS = 3000;
const BROWSER_PROBE_TIMEOUT_MS = 3000;

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface DoctorOptions {
  config: string;
  policy?: string | null;
  out: string;
  baselineDir: string;
  strict?: boolean;
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  playwrightChromiumPath?: string | null;
}

export interface DoctorResult {
  status: DoctorCheckStatus;
  toolVersion: string;
  checks: DoctorCheck[];
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3]!, 10)
  ];
}

function minimumFromRange(range: string): [number, number, number] | null {
  const match = range.match(/>=\s*(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1]!, 10),
    Number.parseInt(match[2]!, 10),
    Number.parseInt(match[3] ?? "0", 10)
  ];
}

export function satisfiesMinimumNode(version: string, range: string): boolean {
  const current = parseVersion(version);
  const minimum = minimumFromRange(range);
  if (!current || !minimum) {
    return false;
  }

  for (let index = 0; index < 3; index += 1) {
    if (current[index]! > minimum[index]!) {
      return true;
    }
    if (current[index]! < minimum[index]!) {
      return false;
    }
  }
  return true;
}

function rankStatus(status: DoctorCheckStatus): number {
  switch (status) {
    case "fail":
      return 3;
    case "warn":
      return 2;
    default:
      return 1;
  }
}

function aggregateStatus(checks: DoctorCheck[]): DoctorCheckStatus {
  return checks.reduce<DoctorCheckStatus>((highest, check) => {
    return rankStatus(check.status) > rankStatus(highest) ? check.status : highest;
  }, "pass");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolvePlaywrightChromiumPath(overridePath?: string | null): string | null {
  if (overridePath !== undefined) {
    return overridePath && existsSync(overridePath) ? overridePath : null;
  }

  try {
    const playwright = require("playwright") as { chromium: { executablePath: () => string } };
    const executablePath = playwright.chromium.executablePath();
    return executablePath && existsSync(executablePath) ? executablePath : null;
  } catch {
    return null;
  }
}

function strictStatus(strict: boolean): DoctorCheckStatus {
  return strict ? "fail" : "warn";
}

async function probeBrowserExecutable(browserPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(browserPath, ["--version"], {
      timeout: BROWSER_PROBE_TIMEOUT_MS,
      windowsHide: true
    });
    const output = `${stdout} ${stderr}`;
    return /\b(chrome|chromium|edge|brave|browser)\b/i.test(output)
      ? null
      : "CHROME_PATH exists but did not identify itself as a browser executable.";
  } catch {
    return "CHROME_PATH exists but could not be launched with --version.";
  }
}

async function probeNativeVisualEngine(
  binaryPath: string,
  env: NodeJS.ProcessEnv
): Promise<string | null> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-doctor-native-"));
  const baselinePath = path.join(tempDir, "baseline.rgba");
  const currentPath = path.join(tempDir, "current.rgba");
  const diffPath = path.join(tempDir, "diff.rgba");
  const invocation = resolveNativeVisualDiffInvocation(binaryPath);

  try {
    const pixel = Buffer.from([255, 255, 255, 255]);
    await Promise.all([writeFile(baselinePath, pixel), writeFile(currentPath, pixel)]);
    const { stdout } = await execFileAsync(
      invocation.command,
      [
        ...invocation.args,
        "--width",
        "1",
        "--height",
        "1",
        "--baseline",
        baselinePath,
        "--current",
        currentPath,
        "--diff-out",
        diffPath,
        "--threshold",
        "0.1"
      ],
      {
        timeout: NATIVE_PROBE_TIMEOUT_MS,
        env: buildNativeVisualDiffChildEnv(env)
      }
    );
    const stdoutText = String(stdout);
    const parsed = JSON.parse(stdoutText.trim()) as { diffPixels?: unknown };
    if (typeof parsed.diffPixels !== "number" || parsed.diffPixels < 0) {
      return "Native visual diff engine failed the health probe; audits will fall back to pixelmatch.";
    }

    const diff = await readFile(diffPath);
    return diff.length === pixel.length
      ? null
      : "Native visual diff engine failed the health probe; audits will fall back to pixelmatch.";
  } catch {
    return "Native visual diff engine failed the health probe; audits will fall back to pixelmatch.";
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function checkBrowser(
  env: NodeJS.ProcessEnv,
  strict: boolean,
  playwrightChromiumPath?: string | null
): Promise<DoctorCheck> {
  const chromePath = env.CHROME_PATH;
  const playwrightChromium = resolvePlaywrightChromiumPath(playwrightChromiumPath);

  if (chromePath) {
    if (existsSync(chromePath)) {
      const probeFailure = await probeBrowserExecutable(chromePath);
      if (probeFailure) {
        if (playwrightChromium) {
          return {
            id: "browser",
            status: "warn",
            message: `${probeFailure} Playwright Chromium is available as a fallback.`,
            details: { chromePath, playwrightChromium }
          };
        }
        return {
          id: "browser",
          status: strictStatus(strict),
          message: probeFailure,
          details: { chromePath }
        };
      }
      return {
        id: "browser",
        status: "pass",
        message: "CHROME_PATH points to a launchable browser executable.",
        details: { chromePath }
      };
    }

    if (playwrightChromium) {
      return {
        id: "browser",
        status: "warn",
        message:
          "CHROME_PATH is set but the file does not exist; Playwright Chromium is available as a fallback.",
        details: { chromePath, playwrightChromium }
      };
    }

    return {
      id: "browser",
      status: "fail",
      message: "CHROME_PATH is set but the file does not exist.",
      details: { chromePath }
    };
  }

  if (playwrightChromium) {
    return {
      id: "browser",
      status: "pass",
      message: "Playwright Chromium is installed and available.",
      details: { playwrightChromium }
    };
  }

  return {
    id: "browser",
    status: strictStatus(strict),
    message:
      "No Chrome executable was found. Set CHROME_PATH or run npx playwright install chromium."
  };
}

async function checkNativeVisualEngine(
  visualConfig: Config["visual"],
  env: NodeJS.ProcessEnv,
  strict: boolean
): Promise<DoctorCheck> {
  const engine = env.WQG_VISUAL_DIFF_ENGINE ?? visualConfig.engine;
  if (!isNativeVisualEngine(engine)) {
    return {
      id: "native-visual-engine",
      status: "pass",
      message: "Native visual diff engine is not requested; pixelmatch will be used.",
      details: { engine: engine ?? "pixelmatch" }
    };
  }

  const binaryPath = env.WQG_VISUAL_DIFF_NATIVE_BIN ?? visualConfig.nativeBinaryPath ?? null;
  if (!binaryPath) {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message:
        "Native visual diff engine is requested but no binary path is configured; audits will fall back to pixelmatch.",
      details: { engine }
    };
  }

  if (!existsSync(binaryPath)) {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message:
        "Native visual diff engine is requested but the configured binary does not exist; audits will fall back to pixelmatch.",
      details: { engine, binaryPath }
    };
  }

  const nativePathType = await classifyNativeVisualDiffPath(binaryPath);
  if (nativePathType === "script") {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message:
        "Native visual diff engine points to a shell, batch, PowerShell, or shebang script. Use a reviewed native binary or a JavaScript test adapter.",
      details: { engine, binaryPath }
    };
  }
  if (nativePathType === "javascript-adapter" && !isTruthy(env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE)) {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message:
        "Native visual diff engine points to a JavaScript adapter. Set WQG_ALLOW_SCRIPT_NATIVE_ENGINE=true only for trusted test adapters.",
      details: { engine, binaryPath }
    };
  }

  if (visualConfig.pixelmatch?.includeAA !== true) {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message:
        "Native visual diff engine is configured, but visual.pixelmatch.includeAA is not true; audits will fall back to pixelmatch to preserve anti-aliased pixel handling.",
      details: { engine, binaryPath }
    };
  }

  if (isCiEnvironment(env) && !isTruthy(env.WQG_ALLOW_NATIVE_VISUAL_ENGINE)) {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message:
        "Native visual diff engine is requested in CI, but WQG_ALLOW_NATIVE_VISUAL_ENGINE=true is not set; audits will fall back to pixelmatch.",
      details: { engine, binaryPath }
    };
  }

  const probeFailure = await probeNativeVisualEngine(binaryPath, env);
  if (probeFailure) {
    return {
      id: "native-visual-engine",
      status: strictStatus(strict),
      message: probeFailure,
      details: { engine, binaryPath }
    };
  }

  return {
    id: "native-visual-engine",
    status: "pass",
    message: "Native visual diff engine passed the health probe for this environment.",
    details: { engine, binaryPath }
  };
}

function checkDirectory(id: string, label: string, directory: string): DoctorCheck {
  try {
    validateOutputDirectory(directory);
    return {
      id,
      status: "pass",
      message: `${label} stays inside the working directory or GITHUB_WORKSPACE.`,
      details: { directory }
    };
  } catch (error) {
    return {
      id,
      status: "fail",
      message: `${label} is not safe for WQG output: ${formatError(error)}`,
      details: { directory }
    };
  }
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const cwd = process.cwd();
  const env = options.env ?? process.env;
  const nodeRange = pkg.engines?.node ?? ">=22.19.0";
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const strict = Boolean(options.strict);
  const checks: DoctorCheck[] = [];
  let visualConfig: Config["visual"] | null = null;

  checks.push({
    id: "node",
    status: satisfiesMinimumNode(nodeVersion, nodeRange) ? "pass" : strictStatus(strict),
    message: `Node.js ${nodeVersion} ${satisfiesMinimumNode(nodeVersion, nodeRange) ? "satisfies" : "does not satisfy"} ${nodeRange}.`,
    details: {
      current: nodeVersion,
      required: nodeRange
    }
  });

  const configPath = path.resolve(cwd, options.config);
  try {
    const config = await loadConfig(configPath, { policy: options.policy ?? null });
    visualConfig = config.visual;
    checks.push({
      id: "config",
      status: "pass",
      message: "Config loaded and passed schema validation.",
      details: {
        configPath,
        pageTargets: config.urls?.length ?? 0,
        screenshots: config.screenshots.length
      }
    });
  } catch (error) {
    checks.push({
      id: "config",
      status: "fail",
      message: `Config validation failed: ${formatError(error)}`,
      details: { configPath }
    });
  }

  if (visualConfig) {
    checks.push(await checkNativeVisualEngine(visualConfig, env, strict));
  }
  checks.push(checkDirectory("out", "Output directory", path.resolve(cwd, options.out)));
  checks.push(
    checkDirectory("baseline", "Baseline directory", path.resolve(cwd, options.baselineDir))
  );
  checks.push(await checkBrowser(env, strict, options.playwrightChromiumPath));

  return {
    status: aggregateStatus(checks),
    toolVersion: pkg.version,
    checks
  };
}

export function formatDoctorText(result: DoctorResult): string {
  const lines = [
    "Web Quality Gatekeeper doctor",
    `Status: ${result.status.toUpperCase()}`,
    `Version: ${result.toolVersion}`,
    ""
  ];

  for (const check of result.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(4)} ${check.message}`);
  }

  return `${lines.join("\n")}\n`;
}
