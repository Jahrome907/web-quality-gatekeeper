import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PackageJson {
  bin?: Record<string, string>;
  exports?: Record<string, string | Record<string, string>>;
  files?: string[];
  main?: string;
  scripts?: Record<string, string>;
  types?: string;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as PackageJson;
}

describe("package metadata", () => {
  it("advertises the CLI, ESM entry, and public API declarations", () => {
    const pkg = readPackageJson();

    expect(pkg.bin?.wqg).toBe("dist/cli.js");
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports?.["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
      default: "./dist/index.js"
    });
  });

  it("builds package entrypoints before npm pack or publish", () => {
    const pkg = readPackageJson();

    expect(pkg.scripts?.prepack).toBe("npm run build");
  });

  it("runs separate runtime and toolchain security audit gates in full validation", () => {
    const pkg = readPackageJson();

    expect(pkg.scripts?.["security:audit"]).not.toContain("--include-dev");
    expect(pkg.scripts?.["security:audit:toolchain"]).toContain("--include-dev");
    expect(pkg.scripts?.["validate:full"]).toContain("npm run security:audit");
    expect(pkg.scripts?.["validate:full"]).toContain("npm run security:audit:toolchain");
  });
  it("isolates browser-heavy smoke files from the parallel unit test pass", () => {
    const pkg = readPackageJson();
    const testScript = pkg.scripts?.test ?? "";

    for (const file of [
      "tests/integration.test.ts",
      "tests/case-study.fixture-smoke.test.ts",
      "tests/package.smoke.test.ts",
      "tests/action.local-smoke.test.ts"
    ]) {
      expect(testScript).toContain(`--exclude ${file}`);
      expect(testScript).toContain(file);
    }
    expect(testScript).toContain("vitest run --no-file-parallelism");
  });

  it("ships only the runtime assets required by installed-package consumers", () => {
    const pkg = readPackageJson();

    expect(pkg.files).toEqual(["dist", "schemas", "configs", "README.md", "LICENSE"]);
    expect(pkg.exports?.["./cli"]).toBe("./dist/cli.js");
    expect(pkg.exports?.["./configs/*"]).toBe("./configs/*");
    expect(pkg.exports?.["./schemas/*"]).toBe("./schemas/*");
    expect(Object.keys(pkg.exports ?? {}).sort()).toEqual([
      ".",
      "./cli",
      "./configs/*",
      "./schemas/*"
    ]);
  });

  it("preserves SummaryV2 for detail summaries and exposes the aggregate contract separately", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "index.ts"), "utf8");

    expect(source).toContain("SummaryV2 as DetailSummaryV2");
    expect(source).toContain("AuditSummaryV2");
    expect(source).not.toContain("AuditSummaryV2 as SummaryV2");
  });
});
