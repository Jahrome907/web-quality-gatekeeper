import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("audit:ci script", () => {
  it("runs against the fixture server instead of invoking audit without a URL", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const source = readFileSync(path.join(ROOT, "scripts", "ci", "audit-ci.mjs"), "utf8");

    expect(pkg.scripts?.["audit:ci"]).toBe("node scripts/ci/audit-ci.mjs");
    expect(source).toContain("startFixtureServer");
    expect(source).toContain("fixture.url");
    expect(source).toContain('path.join(ROOT, "tests", "fixtures", "integration-config.json")');
    expect(source).toContain("--allow-internal-targets");
    expect(source).not.toContain("src/cli.ts audit --config");
  });
});
