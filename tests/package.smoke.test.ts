import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaultConfig.js";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("packaged CLI smoke", () => {
  it("keeps the pack smoke action timeout tolerant on Windows minimum Node", () => {
    const source = readFileSync(path.join(ROOT, "scripts", "ci", "pack-smoke.mjs"), "utf8");
    const expectedActionMs = defaultConfig.timeouts.actionMs;

    expect(source).toMatch(new RegExp(`actionMs:\\s*${expectedActionMs}\\b`));
    expect(source).not.toMatch(/actionMs:\s*5000\b/);
  });

  it("uses the real repo pack lifecycle and an external clean consumer project", () => {
    const source = readFileSync(path.join(ROOT, "scripts", "ci", "pack-smoke.mjs"), "utf8");

    expect(source).toContain('mkdtemp(path.join(tmpdir(), "wqg-pack-smoke-"))');
    expect(source).toContain('["pack", "--silent", "--pack-destination", smokeRoot]');
    expect(source).not.toContain('"--ignore-scripts", "--pack-destination"');
    expect(source).not.toContain("package-source");
  });
});
