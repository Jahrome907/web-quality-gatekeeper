import path from "node:path";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
function resolveChromePath(): string {
  const env = { ...process.env };
  delete env.GITHUB_ENV;
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "scripts", "ci", "resolve-chrome-path.mjs")],
    {
      cwd: ROOT,
      encoding: "utf8",
      env
    }
  );

  if (result.status !== 0) {
    return "";
  }

  const candidate = (result.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (!candidate) {
    return "";
  }
  return existsSync(candidate) ? candidate : "";
}
function resolveBashCommand() {
  if (process.env.WQG_ACTION_SMOKE_BASH) {
    const candidate = process.env.WQG_ACTION_SMOKE_BASH;
    return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0 ? candidate : null;
  }

  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
          "bash"
        ]
      : ["bash"];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }

  return null;
}

const ACTION_BASH = resolveBashCommand();
const ACTION_CHROME_PATH = resolveChromePath();
const HAS_ACTION_BASH =
  ACTION_BASH !== null &&
  spawnSync(ACTION_BASH, ["-lc", "command -v node >/dev/null 2>&1"], { stdio: "ignore" }).status ===
    0;
const HAS_ACTION_BROWSER =
  HAS_ACTION_BASH &&
  spawnSync(
    ACTION_BASH!,
    [
      "-lc",
      "node -e \"const fs=require('node:fs');if(process.env.CHROME_PATH&&fs.existsSync(process.env.CHROME_PATH))process.exit(0);const { chromium } = require('playwright');process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)\""
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        ...(ACTION_CHROME_PATH ? { CHROME_PATH: ACTION_CHROME_PATH } : {})
      },
      stdio: "ignore"
    }
  ).status === 0;

describe("local composite action smoke", () => {
  it("fails when a runnable bash action environment is unavailable", async () => {
    await expect(
      execFileAsync("node", [path.join(ROOT, "scripts", "ci", "local-action-smoke.mjs")], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 30000,
        env: {
          ...process.env,
          NO_COLOR: "1",
          WQG_ACTION_SMOKE_BASH: path.join(ROOT, "missing-bash")
        }
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Local action smoke requires a bash node runtime with CHROME_PATH or a Playwright browser installed."
      )
    });
  }, 30000);

  it("does not export CHROME_PATH directories as browser executables", async () => {
    const chromePath = await mkdtemp(path.join(tmpdir(), "wqg-action-chrome-path-"));
    const githubEnvPath = path.join(chromePath, "github-env");
    try {
      await writeFile(githubEnvPath, "", "utf8");

      const { stdout } = await execFileAsync(
        "node",
        [path.join(ROOT, "scripts", "ci", "resolve-chrome-path.mjs")],
        {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 30000,
          env: {
            ...process.env,
            NO_COLOR: "1",
            CHROME_PATH: chromePath,
            GITHUB_ENV: githubEnvPath
          }
        }
      );
      const githubEnv = await readFile(githubEnvPath, "utf8");

      expect(stdout).not.toContain(chromePath);
      expect(githubEnv).not.toContain(`CHROME_PATH=${chromePath}`);

      const fakeChromePath = path.join(
        chromePath,
        process.platform === "win32" ? "chrome.exe" : "google-chrome"
      );
      await writeFile(fakeChromePath, "not a browser", "utf8");
      await writeFile(githubEnvPath, "", "utf8");
      const fakeRun = await execFileAsync(
        "node",
        [path.join(ROOT, "scripts", "ci", "resolve-chrome-path.mjs")],
        {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 30000,
          env: {
            ...process.env,
            NO_COLOR: "1",
            CHROME_PATH: fakeChromePath,
            GITHUB_ENV: githubEnvPath
          }
        }
      );
      const fakeGithubEnv = await readFile(githubEnvPath, "utf8");
      expect(fakeRun.stdout).not.toContain(fakeChromePath);
      expect(fakeGithubEnv).not.toContain(`CHROME_PATH=${fakeChromePath}`);
    } finally {
      await rm(chromePath, { recursive: true, force: true });
    }
  }, 30000);
  it("exports browser executables discovered from PATH", async () => {
    if (process.platform === "win32") {
      return;
    }

    const binDir = await mkdtemp(path.join(tmpdir(), "wqg-action-path-browser-"));
    const githubEnvPath = path.join(binDir, "github-env");
    const executablePath = path.join(binDir, "google-chrome");
    try {
      await writeFile(executablePath, "#!/bin/sh\necho Chromium 120.0.0.0\n", "utf8");
      await chmod(executablePath, 0o755);
      await writeFile(githubEnvPath, "", "utf8");

      const { stdout } = await execFileAsync(
        "node",
        [path.join(ROOT, "scripts", "ci", "resolve-chrome-path.mjs")],
        {
          cwd: ROOT,
          encoding: "utf8",
          timeout: 30000,
          env: {
            ...process.env,
            NO_COLOR: "1",
            CHROME_PATH: "",
            GITHUB_ENV: githubEnvPath,
            PATH: binDir + path.delimiter + (process.env.PATH ?? "")
          }
        }
      );
      const githubEnv = await readFile(githubEnvPath, "utf8");

      expect(stdout).toContain(executablePath);
      expect(githubEnv).toContain(`CHROME_PATH=${executablePath}`);
    } finally {
      await rm(binDir, { recursive: true, force: true });
    }
  }, 30000);
  it("executes the checked-in action from a workspace consumer context", async () => {
    expect(HAS_ACTION_BROWSER).toBe(true);

    const { stdout } = await execFileAsync(
      "node",
      [path.join(ROOT, "scripts", "ci", "local-action-smoke.mjs")],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 180000,
        env: {
          ...process.env,
          NO_COLOR: "1",
          ...(ACTION_CHROME_PATH ? { CHROME_PATH: ACTION_CHROME_PATH } : {})
        }
      }
    );

    expect(stdout).toContain("Local action smoke completed.");
  }, 180000);
});
