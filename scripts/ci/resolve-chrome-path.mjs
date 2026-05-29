/* global console, process */
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

const candidatesByPlatform = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ]
};

function pathCandidates(names) {
  const searchPath = process.env.PATH ?? "";
  const directories = searchPath.split(path.delimiter).filter(Boolean);
  return directories.flatMap((directory) => names.map((name) => path.join(directory, name)));
}

function resolveChromePath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const platformCandidates = candidatesByPlatform[process.platform] ?? [];
  const executableCandidates =
    process.platform === "win32"
      ? pathCandidates(["chrome.exe"])
      : pathCandidates(["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]);

  return [...platformCandidates, ...executableCandidates].find((candidate) => existsSync(candidate)) ?? "";
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
