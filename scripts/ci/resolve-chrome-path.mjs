/* global console, process */
import { appendFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const candidatesByPlatform = {
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

const pathExecutableNamesByPlatform = {
  darwin: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  linux: ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"],
  win32: ["chrome.exe", "msedge.exe", "brave.exe"]
};

function pathCandidates(names) {
  const searchPath = process.env.PATH ? process.env.PATH : "";
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  return directories.flatMap(function (directory) {
    return names.map(function (name) {
      return path.join(directory, name);
    });
  });
}
const browserVersionPattern =
  /\b(google chrome|chromium|chrome for testing|microsoft edge|brave browser)\b/i;

const trustedWindowsBrowserPaths = new Set(
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].map((candidate) => candidate.toLowerCase())
);

function isBrowserExecutableFile(candidate) {
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      return false;
    }
    if (process.platform === "win32" && trustedWindowsBrowserPaths.has(candidate.toLowerCase())) {
      return true;
    }
    const output = execFileSync(candidate, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3000,
      windowsHide: true
    });
    return browserVersionPattern.test(output);
  } catch {
    return false;
  }
}

function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    if (isBrowserExecutableFile(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }
  }

  const platformCandidates = candidatesByPlatform[process.platform]
    ? candidatesByPlatform[process.platform]
    : [];
  const pathExecutableNames = pathExecutableNamesByPlatform[process.platform]
    ? pathExecutableNamesByPlatform[process.platform]
    : [];
  const executableCandidates = pathCandidates(pathExecutableNames);
  return (
    executableCandidates.concat(platformCandidates).find(function (candidate) {
      return isBrowserExecutableFile(candidate);
    }) || ""
  );
}
const chromePath = resolveChromePath();
if (chromePath) {
  console.log(chromePath);
  if (process.env.GITHUB_ENV) {
    appendFileSync(process.env.GITHUB_ENV, `CHROME_PATH=${chromePath}\n`, "utf8");
  }
} else {
  console.log("Chrome executable not found; Playwright browser install fallback remains enabled.");
}
