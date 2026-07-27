import path from "node:path";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaultConfig.js";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");

describe("packaged CLI smoke", () => {
  it("keeps the pack smoke action timeout tolerant on Windows minimum Node", () => {
    const source = readFileSync(path.join(ROOT, "scripts", "ci", "pack-smoke.mjs"), "utf8");
    const expectedActionMs = defaultConfig.timeouts.actionMs;

    expect(source).toMatch(new RegExp(`actionMs:\\s*${expectedActionMs}\\b`));
    expect(source).not.toMatch(/actionMs:\s*5000\b/);
  });
  it("packs the repo root tarball with the same npm pack mode used by npm publish", () => {
    const source = readFileSync(path.join(ROOT, "scripts", "ci", "pack-smoke.mjs"), "utf8");

    expect(source).toContain(
      '["pack", "--ignore-scripts", "--json", "--pack-destination", smokeRoot]'
    );
    expect(source).toContain("{ cwd: ROOT }");
    expect(source).toContain('["-tf", tarballName]');
    expect(source).toContain("{ cwd: smokeRoot }");
    expect(source).toContain('["-xf", path.basename(tarballPath), "-C", stagingDir]');
    expect(source).not.toContain('["-tf", tarballPath]');
    expect(source).not.toContain("package-source");
    expect(source).toContain('"package/package.json"');
    expect(source).toContain('"package/configs/security/audit-exceptions.json"');
    expect(source).toContain('"package/dist/cli.js.map"');
    expect(source).not.toContain('"package/tests/"');
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
          npm_config_cache: path.join(ROOT, ".tmp-npm-cache-package-smoke-test"),
          WQG_PACK_SMOKE_KEEP_DIST: "true"
        }
      }
    );

    expect(stdout).toContain("Pack smoke completed.");
  }, 720000);
});
