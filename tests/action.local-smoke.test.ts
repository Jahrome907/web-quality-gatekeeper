import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
const HAS_ACTION_BASH =
  spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("bash", ["-lc", "command -v node >/dev/null 2>&1"], { stdio: "ignore" }).status === 0;

describe.skipIf(!HAS_ACTION_BASH)("local composite action smoke", () => {
  it("executes the checked-in action from a workspace consumer context", async () => {
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
        },
      }
    );

    expect(stdout).toContain("Local action smoke completed.");
  }, 180000);
});
