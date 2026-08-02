import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function listFiles(relativeDir: string, extensions: Set<string>): string[] {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(relativePath, extensions);
    }
    return entry.isFile() && extensions.has(path.extname(entry.name)) ? [relativePath] : [];
  });
}

function normalizeMarkdownLinkTarget(target: string): string {
  return target.trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
}

describe("maintainer documentation", () => {
  it("keeps the README adoption-first and bounded", () => {
    const readme = readRepoFile("README.md");

    expect(readme.split(/\r?\n/).length).toBeLessThan(250);
    expect(readme).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(readme).toContain("Contract-checked JSON formats are covered by versioned schemas");
    expect(readme).toContain("The `policy` input is optional");
    expect(readme).toContain("tools/python/README.md");
    expect(readme).not.toContain("url: https://your-site.example\n          policy: marketing");
    expect(readme).toContain("Version `3.2.3` is not published to npm");
    expect(readme).toContain("node dist/cli.js audit");
    expect(readme).toContain("steps.wqg.outputs.sensitive-audit");
    expect(readme).toContain("docs/case-study-run.md");
    expect(readme).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(readme).toContain("docs/testing-matrix.md");
    expect(readme).not.toMatch(/source-[0-9]+\.[0-9]+\.[0-9]+/);
    expect(readme).not.toContain("npm install web-quality-gatekeeper");
  });

  it("keeps contributor guidance scoped to real validation entrypoints", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    const pkg = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> };

    for (const command of [
      "engines:check",
      "check",
      "contracts:check",
      "smoke:action",
      "smoke:pack",
      "release:dry-run"
    ]) {
      expect(pkg.scripts).toHaveProperty(command);
      expect(contributing).toContain(`npm run ${command}`);
    }

    expect(contributing).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(contributing).toContain("docs/testing-matrix.md");
    expect(contributing).toContain("npx playwright install --with-deps chromium");
  });

  it("keeps essential OSS and maintainer documents while excluding archived process records", () => {
    for (const relativePath of [
      "README.md",
      "LICENSE",
      "SECURITY.md",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "docs/engineering/ARCHITECTURE_MAP.md",
      "docs/engineering/WORKFLOW_SAFETY_POLICY.md",
      "docs/contracts/compatibility-baseline.md",
      "docs/provenance.md",
      "docs/sbom.md",
      "docs/roadmap.md"
    ]) {
      expect(existsSync(path.join(process.cwd(), relativePath)), relativePath).toBe(true);
    }

    for (const relativePath of [
      "docs/engineering/FULL_REPO_AUDIT_2026-05-30.md",
      "docs/engineering/RELEASE_3.1.4_READINESS.md"
    ]) {
      expect(existsSync(path.join(process.cwd(), relativePath)), relativePath).toBe(false);
    }
  });

  it("keeps repository-local Markdown links resolvable", () => {
    const markdownFiles = [
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      ...listFiles("docs", new Set([".md"])),
      ...listFiles(".github", new Set([".md"]))
    ];
    const missingLinks: string[] = [];

    for (const relativePath of markdownFiles) {
      const source = readRepoFile(relativePath);
      const sourceDir = path.dirname(path.join(process.cwd(), relativePath));
      for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const rawTarget = normalizeMarkdownLinkTarget(match[1] ?? "");
        if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
          continue;
        }

        const targetWithoutAnchor = rawTarget.split("#")[0] ?? "";
        if (!targetWithoutAnchor) {
          continue;
        }

        const absoluteTarget = path.resolve(sourceDir, decodeURIComponent(targetWithoutAnchor));
        if (!existsSync(absoluteTarget)) {
          missingLinks.push(`${relativePath} -> ${rawTarget}`);
        } else if (statSync(absoluteTarget).isDirectory()) {
          missingLinks.push(`${relativePath} -> ${rawTarget} points to a directory`);
        }
      }
    }

    expect(missingLinks).toEqual([]);
  });

  it("keeps documented commands backed by real scripts and test files", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> };
    const knownScripts = new Set(Object.keys(pkg.scripts ?? {}));
    const optionalScripts = new Set(["demo"]);
    const referenceFiles = [
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      ...listFiles("docs", new Set([".md"])),
      ...listFiles(".github", new Set([".md", ".yml", ".yaml"]))
    ];
    const missingReferences: string[] = [];

    for (const relativePath of referenceFiles) {
      const source = readRepoFile(relativePath);

      for (const match of source.matchAll(/\bnpm run ([a-zA-Z0-9:._-]+)/g)) {
        const scriptName = match[1] ?? "";
        if (!knownScripts.has(scriptName) && !optionalScripts.has(scriptName)) {
          missingReferences.push(`${relativePath} references missing npm script: ${scriptName}`);
        }
      }

      for (const match of source.matchAll(/\bnode (scripts\/[a-zA-Z0-9/._-]+\.mjs)\b/g)) {
        const scriptPath = match[1] ?? "";
        if (!existsSync(path.join(process.cwd(), scriptPath))) {
          missingReferences.push(`${relativePath} references missing Node script: ${scriptPath}`);
        }
      }

      for (const match of source.matchAll(/\b(tests\/[a-zA-Z0-9/._-]+\.ts)\b/g)) {
        const testPath = match[1] ?? "";
        if (!existsSync(path.join(process.cwd(), testPath))) {
          missingReferences.push(`${relativePath} references missing test file: ${testPath}`);
        }
      }
    }

    expect(missingReferences).toEqual([]);
  });

  it("distinguishes source-generated release evidence from published assets", () => {
    const provenance = readRepoFile("docs/provenance.md");
    const sbom = readRepoFile("docs/sbom.md");

    expect(provenance).toContain("Inspect the assets attached to the specific Release");
    expect(provenance).toContain("not evidence that a GitHub Release or npm package was published");
    expect(sbom).toContain("inspect that GitHub Release's attached assets");
    expect(sbom).toContain("is not proof that the same file was attached to a Release");
    expect(provenance).not.toContain("Starting with v3.2.3");
    expect(sbom).not.toContain("Starting with v3.2.3");
  });

  it("keeps the compatibility index concise and tied to authoritative contracts", () => {
    const compatibility = readRepoFile("docs/contracts/compatibility-baseline.md");

    expect(compatibility.split(/\r?\n/).length).toBeLessThan(120);
    expect(compatibility).toContain("schemas/summary.v1.json");
    expect(compatibility).toContain("schemas/summary.v2.json");
    expect(compatibility).toContain("schemas/pr-risk-ledger.v1.json");
    expect(compatibility).toContain("sensitive-audit");
    expect(compatibility).not.toContain("Historical 3.1.4 tarball contents");
    expect(compatibility).not.toContain("Remaining Follow-ups");
  });

  it("keeps the public comparison protocol project-neutral", () => {
    const protocol = readRepoFile("docs/case-study/public-oss-repro.md");

    expect(protocol).toContain("baseline commit SHA");
    expect(protocol).toContain("improved commit SHA");
    expect(protocol).toContain("provenance.json");
    expect(protocol).not.toContain("Candidate Repositories");
    expect(protocol).not.toContain("vitejs/vite");
  });
});
