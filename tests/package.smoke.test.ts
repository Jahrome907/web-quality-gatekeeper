import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");

describe("packaged CLI smoke", () => {
  it("installs the tarball in a clean project and runs a real audit with shipped assets", async () => {
    const { stdout } = await execFileAsync("node", [path.join(ROOT, "scripts", "ci", "pack-smoke.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 720000,
      env: {
        ...process.env,
        NO_COLOR: "1"
      }
    });

    expect(stdout).toContain("Pack smoke completed.");
  }, 720000);
});
