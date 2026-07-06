import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const BROWSER_VERSION_PATTERN =
  /\b(google chrome|chromium|chrome for testing|microsoft edge|brave browser)\b/i;

const BROWSER_CANDIDATES_BY_PLATFORM: Record<string, string[]> = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium"
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ]
};

const PATH_EXECUTABLE_NAMES_BY_PLATFORM: Record<string, string[]> = {
  darwin: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  linux: ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
  win32: ["chrome.exe", "msedge.exe", "brave.exe"]
};

function pathCandidates(names: string[]): string[] {
  const searchPath = process.env.PATH ? process.env.PATH : "";
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  return directories.flatMap(function (directory) {
    return names.map(function (name) {
      return path.join(directory, name);
    });
  });
}
const TRUSTED_WINDOWS_BROWSER_PATHS = new Set(
  (BROWSER_CANDIDATES_BY_PLATFORM.win32 ?? []).map((candidate) => candidate.toLowerCase())
);

export function isBrowserExecutableFile(candidate: string): boolean {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      return false;
    }
    if (
      process.platform === "win32" &&
      TRUSTED_WINDOWS_BROWSER_PATHS.has(candidate.toLowerCase())
    ) {
      return true;
    }
    const output = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
      windowsHide: true
    });
    return BROWSER_VERSION_PATTERN.test(output);
  } catch {
    return false;
  }
}

export function resolveBrowserExecutablePath(preferredPath?: string): string | undefined {
  if (preferredPath) {
    if (isBrowserExecutableFile(preferredPath)) {
      return preferredPath;
    }
  }

  const platformCandidates = BROWSER_CANDIDATES_BY_PLATFORM[process.platform] ?? [];
  const pathExecutableNames = PATH_EXECUTABLE_NAMES_BY_PLATFORM[process.platform] ?? [];
  const executableCandidates = pathCandidates(pathExecutableNames);
  return executableCandidates.concat(platformCandidates).find(function (candidate) {
    return isBrowserExecutableFile(candidate);
  });
}
