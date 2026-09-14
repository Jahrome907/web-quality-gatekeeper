import { existsSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig } from "./config/loadConfig.js";
import { assertSupportedVisualDiffEnvironment } from "./config/visualDiffMigration.js";
import { validateOutputDirectory } from "./utils/fs.js";
import {
  isBrowserExecutableFile,
  resolveBrowserExecutablePath
} from "./utils/browserExecutable.js";
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as {
  version: string;
  engines?: { node?: string };
};
const BROWSER_PROBE_TIMEOUT_MS = 3000;

export type DoctorCheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface BrowserProbeResult {
  ok: boolean;
  version?: string;
  message?: string;
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
  browserProbe?: (chromePath: string, env: NodeJS.ProcessEnv) => Promise<BrowserProbeResult>;
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

async function probeBrowserExecutable(
  chromePath: string,
  env: NodeJS.ProcessEnv
): Promise<BrowserProbeResult> {
  if (isBrowserExecutableFile(chromePath)) {
    return { ok: true };
  }

  try {
    const { stdout, stderr } = await execFileAsync(chromePath, ["--version"], {
      timeout: BROWSER_PROBE_TIMEOUT_MS,
      env
    });
    const version = `${stdout}\n${stderr}`.trim();
    if (/\b(google chrome|chromium|chrome|microsoft edge|brave browser)\b/i.test(version)) {
      return { ok: true, version };
    }
    return {
      ok: false,
      message: "CHROME_PATH exists but does not identify as a Chrome/Chromium browser."
    };
  } catch {
    return {
      ok: false,
      message: "CHROME_PATH exists but failed the browser executable probe."
    };
  }
}

async function checkBrowser(
  env: NodeJS.ProcessEnv,
  strict: boolean,
  playwrightChromiumPath?: string | null,
  browserProbe: DoctorOptions["browserProbe"] = probeBrowserExecutable
): Promise<DoctorCheck> {
  const chromePath = env.CHROME_PATH;
  const playwrightChromium = resolvePlaywrightChromiumPath(playwrightChromiumPath);

  if (chromePath) {
    if (existsSync(chromePath) && statSync(chromePath).isFile()) {
      const probe = await browserProbe(chromePath, env);
      if (probe.ok) {
        return {
          id: "browser",
          status: "pass",
          message: "CHROME_PATH passed the browser executable probe.",
          details: { chromePath, version: probe.version ?? null }
        };
      }
      return {
        id: "browser",
        status: strictStatus(strict),
        message: probe.message ?? "CHROME_PATH exists but failed the browser executable probe.",
        details: { chromePath }
      };
    }

    if (existsSync(chromePath)) {
      return {
        id: "browser",
        status: strict ? "fail" : "warn",
        message: "CHROME_PATH exists but is not a browser executable file.",
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

  const systemChromePath = resolveBrowserExecutablePath();
  if (systemChromePath) {
    return {
      id: "browser",
      status: "pass",
      message: "System Chrome/Chromium browser was found and is available.",
      details: { chromePath: systemChromePath }
    };
  }

  return {
    id: "browser",
    status: strictStatus(strict),
    message:
      "No Chrome executable was found. Set CHROME_PATH or run npx playwright install chromium."
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
  assertSupportedVisualDiffEnvironment(env);
  const nodeRange = pkg.engines?.node ?? ">=22.19.0";
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const strict = Boolean(options.strict);
  const checks: DoctorCheck[] = [];

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

  checks.push(checkDirectory("out", "Output directory", path.resolve(cwd, options.out)));
  checks.push(
    checkDirectory("baseline", "Baseline directory", path.resolve(cwd, options.baselineDir))
  );
  checks.push(
    await checkBrowser(env, strict, options.playwrightChromiumPath, options.browserProbe)
  );

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
