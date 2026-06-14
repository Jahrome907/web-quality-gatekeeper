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

  it("ships runtime assets required by installed-package consumers", () => {
    const pkg = readPackageJson();

    expect(pkg.files).toEqual(
      expect.arrayContaining(["dist", "schemas", "configs", "README.md", "LICENSE"])
    );
    expect(pkg.exports?.["./configs/*"]).toBe("./configs/*");
    expect(pkg.exports?.["./schemas/*"]).toBe("./schemas/*");
  });

  it("preserves SummaryV2 for detail summaries and exposes the aggregate contract separately", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "index.ts"), "utf8");

    expect(source).toContain("SummaryV2 as DetailSummaryV2");
    expect(source).toContain("AuditSummaryV2");
    expect(source).not.toContain("AuditSummaryV2 as SummaryV2");
  });
});
