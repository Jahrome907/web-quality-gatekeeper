import path from "node:path";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");

describe("packaged CLI smoke", () => {
  it("keeps the pack smoke action timeout tolerant on Windows minimum Node", () => {
    const source = readFileSync(path.join(ROOT, "scripts", "ci", "pack-smoke.mjs"), "utf8");

    expect(source).toContain("actionMs: 10000");
    expect(source).not.toContain("actionMs: 5000");
  });

  it("installs the tarball in a clean project and runs a real audit with shipped assets", async () => {
    const { stdout } = await execFileAsync(
      "node",
      [path.join(ROOT, "scripts", "ci", "pack-smoke.mjs")],
      {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 720000,
        env: {
          ...process.env,
          NO_COLOR: "1",
          WQG_PACK_SMOKE_KEEP_DIST: "true"
        }
      }
    );

    expect(stdout).toContain("Pack smoke completed.");
  }, 720000);
});
