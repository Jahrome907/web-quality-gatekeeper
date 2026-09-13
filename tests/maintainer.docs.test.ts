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

describe("documentation references", () => {
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
        if (!knownScripts.has(scriptName)) {
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
});
