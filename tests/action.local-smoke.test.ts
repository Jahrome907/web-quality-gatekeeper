import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");

function resolveBashCommand() {
  if (process.env.WQG_ACTION_SMOKE_BASH) {
    const candidate = process.env.WQG_ACTION_SMOKE_BASH;
    return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0
      ? candidate
      : null;
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
const HAS_ACTION_BASH =
  ACTION_BASH !== null &&
  spawnSync(ACTION_BASH, ["-lc", "command -v node >/dev/null 2>&1"], { stdio: "ignore" }).status === 0;
const HAS_ACTION_PLAYWRIGHT_BROWSER =
  HAS_ACTION_BASH &&
  spawnSync(
    ACTION_BASH!,
    [
      "-lc",
      "node -e \"const fs=require('node:fs');const { chromium } = require('playwright');process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1)\""
    ],
    {
      cwd: ROOT,
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
        "Local action smoke requires a bash node runtime with a Playwright browser installed."
      )
    });
  }, 30000);

  it("executes the checked-in action from a workspace consumer context", async () => {
    expect(HAS_ACTION_PLAYWRIGHT_BROWSER).toBe(true);

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
        }
      }
    );

    expect(stdout).toContain("Local action smoke completed.");
  }, 180000);
});
