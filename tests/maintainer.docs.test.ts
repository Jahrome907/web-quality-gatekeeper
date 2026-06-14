import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function listMarkdownFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(process.cwd(), relativeDir);
  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listMarkdownFiles(relativePath);
    }
    return entry.isFile() && entry.name.endsWith(".md") ? [relativePath] : [];
  });
}

function normalizeMarkdownLinkTarget(target: string): string {
  return target.trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
}

function expectTextOrder(source: string, orderedText: string[]): void {
  let cursor = -1;
  for (const text of orderedText) {
    const index = source.indexOf(text, cursor + 1);
    expect(index, `Expected ${text} after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = index;
  }
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

describe("maintainer documentation", () => {
  it("keeps contributor guidance linked to architecture references", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    const readme = readRepoFile("README.md");
    const docsIndex = readRepoFile("docs/index.html");
    const caseStudyRun = readRepoFile("docs/case-study-run.md");
    const provenance = readRepoFile("docs/provenance.md");

    expect(contributing).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(contributing).toContain("docs/testing-matrix.md");
    expect(contributing).toContain("npx playwright install --with-deps chromium");
    expect(contributing).toContain("npx playwright install chromium");
    expect(readme).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(readme).toContain("docs/testing-matrix.md");
    expect(readme).toContain("npm run engines:check");
    expect(readme).toContain("npm run validate:full");
    for (const source of [contributing, readme, docsIndex, caseStudyRun, provenance]) {
      expectTextOrder(source, [
        "npm run engines:check",
        "npm ci",
        "npx playwright install chromium"
      ]);
    }
    expect(caseStudyRun).toContain(
      "Confirm `npm run engines:check` passes for the current Node.js runtime before treating the run as release evidence."
    );
  });

  it("publishes architecture doc with maintainer gate references", () => {
    const architecturePath = path.join(process.cwd(), "docs/engineering/ARCHITECTURE_MAP.md");

    expect(existsSync(architecturePath)).toBe(true);

    const architecture = readFileSync(architecturePath, "utf8");

    expect(architecture).toContain("src/cli.ts");
    expect(architecture).toContain("src/index.ts");
    expect(architecture).toContain("action.yml");
    expect(architecture).toContain("scripts/ci/*");
  });

  it("keeps release-sensitive workflow policy aligned with the Node preflight", () => {
    const workflowPolicy = readRepoFile("docs/engineering/WORKFLOW_SAFETY_POLICY.md");
    const contributing = readRepoFile("CONTRIBUTING.md");
    const releaseDryRun = readRepoFile("scripts/ci/release-dry-run.mjs");

    expect(workflowPolicy).toContain("Release-prep validation through `npm run release:dry-run`");
    expect(workflowPolicy).toContain("Node engine preflight: `npm run engines:check`");
    expect(workflowPolicy).toContain("Runtime dependency audit remains covered by");
    expect(workflowPolicy).toMatch(/package smoke, Action\s+smoke, and Python smoke/);
    expect(contributing).toContain("npm run engines:check");
    expect(contributing).toContain("npm run python:smoke");
    expect(releaseDryRun).toContain("assertNodeEngine()");
    expect(releaseDryRun).toContain('args: ["run", "python:smoke"]');
    expect(releaseDryRun).not.toContain('args: ["run", "security:audit"]');
  });

  it("keeps repository-local Markdown links resolvable", () => {
    const markdownFiles = [
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      ...listMarkdownFiles("docs"),
      ...listMarkdownFiles(".github")
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

  it("keeps documented command references backed by real scripts and test files", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> };
    const knownScripts = new Set(Object.keys(pkg.scripts ?? {}));
    const optionalScripts = new Set(["demo"]);
    const referenceFiles = [
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "package.json",
      "action.yml",
      ...listMarkdownFiles("docs"),
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

  it("keeps historical release notes framed as archived evidence", () => {
    const historicalRelease = readRepoFile("docs/engineering/RELEASE_3.1.4_READINESS.md");
    const fullAudit = readRepoFile("docs/engineering/FULL_REPO_AUDIT_2026-05-30.md");
    const normalizedFullAudit = fullAudit.replace(/\s+/g, " ");

    expect(historicalRelease).toContain("archived readiness record");
    expect(historicalRelease).toContain("Do not use it as the current");
    expect(historicalRelease).toContain("Historical Required Verification");
    expect(historicalRelease).not.toContain(["generated", "tool wording"].join("-"));
    expect(fullAudit).toContain("Archived engineering record");
    expect(normalizedFullAudit).toContain(
      "Do not use it as the current release-readiness statement"
    );
    expect(fullAudit).not.toContain("outside the Windows sandbox");
    expect(fullAudit).not.toContain("22.17.1");
    expect(fullAudit).not.toContain("cargo is not installed");
    expect(fullAudit).not.toContain("this machine");
  });

  it("keeps the roadmap focused on remaining work", () => {
    const roadmap = readRepoFile("docs/roadmap.md");
    const readme = readRepoFile("README.md");

    expect(readme).toContain("profile-specific coverage, baseline guidance");
    expect(readme).toContain("report artifact upload step");
    expect(roadmap).not.toContain(
      "Expand `wqg init` templates with profile-specific comments and baseline guidance."
    );
  });

  it("keeps Unreleased changelog notes aligned with current hardening surfaces", () => {
    const changelog = readRepoFile("CHANGELOG.md");
    const unreleased = changelog.slice(
      changelog.indexOf("## [Unreleased]"),
      changelog.indexOf("## [3.1.6]")
    );

    expect(unreleased).toContain("`wqg doctor`");
    expect(unreleased).toContain("`wqg init --profile <name> --url <url>`");
    expect(unreleased).toContain("upload report artifacts");
    expect(unreleased).toContain("Action-emitted summary, report, Action Plan");
    expect(unreleased).toContain("current pinned checkout and upload-artifact actions");
    expect(unreleased).toContain("Summary v2 schema/version advanced to `2.3.0`");
    expect(unreleased).toContain("`schemas/pr-risk-ledger.v1.json`");
    expect(unreleased).toContain("Fixture case-study provenance");
    expect(unreleased).toContain("Composite Action outputs");
    expect(unreleased).toContain("PR Risk Ledger artifacts");
    expect(unreleased).toContain("Public baseline/improved case-study provenance");
    expect(unreleased).toContain("required review and screenshot artifacts");
    expect(unreleased).toContain("Node engine preflight");
    expect(unreleased).toContain("Pack smoke");
    expect(unreleased).toContain("rebuild stale `dist` output");
    expect(unreleased).toContain("isolated built-runtime snapshot");
    expect(unreleased).toContain("CLI shebang integrity");
    expect(unreleased).toContain("installed `wqg init` artifact-upload scaffolding");
    expect(unreleased).toContain("Native visual diff execution is disabled in CI");
    expect(unreleased).toContain("Python smoke diagnostics");
    expect(unreleased).toContain("bytecode caches");
    expect(unreleased).toContain("Python analytics smoke");
    expect(unreleased).toContain("pull request checklist");
    expect(unreleased).toContain("avoids rerunning the runtime audit");
    expect(unreleased).toContain("quality-gate workflow");
    expect(unreleased).toContain("manual npm publish workflow");
    expect(unreleased).toContain("native visual diff workflow now pins Node 24");
    expect(unreleased).toContain("native runtime support helper changes");
    expect(unreleased).toContain(
      "repo-owned workflows now run the Node engine preflight before dependency install"
    );
    expect(unreleased).toContain("Package smoke coverage now runs on both Node 22.19 and Node 24");
    expect(unreleased).toContain("README repo-development command list");
    expect(unreleased).toContain("Protocol-relative screenshot paths are rejected");
    expect(unreleased).toContain("combined summary and PR Risk Ledger contract gate");
    expect(unreleased).toContain("Compatibility baseline follow-ups");
    expect(unreleased).toContain(
      "Auth headers and cookies now follow verified navigation redirects"
    );
    expect(unreleased).toContain("audited landing URL after redirects");
    expect(unreleased).toContain("Stable major Action tag publication");
    expect(unreleased).toContain("composite Action no longer checks out");
    expect(unreleased).toContain("trusted-publishing runtime preflight now resolves `npm.cmd`");
  });

  it("keeps summary v2 migration guidance aligned with current aggregate artifacts", () => {
    const migration = readRepoFile("docs/migrations/summary-v2.md");
    const compatibility = readRepoFile("docs/contracts/compatibility-baseline.md");

    expect(migration).toContain("summary.v2.json#artifacts.actionPlanMd");
    expect(migration).toContain("summary.v2.json#artifacts.prRiskLedgerJson");
    expect(migration).toContain("summary.v2.json#artifacts.prRiskLedgerMd");
    expect(compatibility).toContain("default summary/report/action-plan/PR Risk Ledger artifacts");
    expect(compatibility).toContain("default report/action-plan/PR");
  });

  it("keeps the testing matrix aligned with contract gate coverage", () => {
    const matrix = readRepoFile("docs/testing-matrix.md");
    const contributing = readRepoFile("CONTRIBUTING.md");

    expect(matrix).toContain("summary and PR Risk Ledger contract drift gate");
    expect(matrix).toContain("PR Risk Ledger schema/runtime/doc alignment");
    expect(matrix).toContain("docs/contracts/pr-risk-ledger-v1-contract.md");
    expect(matrix).toContain("schemas/pr-risk-ledger.v1.json");
    expect(matrix).toContain("cache-free smoke runs");
    expect(matrix).toContain("tests/python-smoke.test.ts");
    expect(contributing).toContain("summary and PR Risk Ledger contract drift gate");
  });

  it("keeps architecture and compatibility docs aligned with PR Risk Ledger contract coverage", () => {
    const architecture = readRepoFile("docs/engineering/ARCHITECTURE_MAP.md");
    const compatibility = readRepoFile("docs/contracts/compatibility-baseline.md");
    const qualityGate = readRepoFile(".github/workflows/quality-gate.yml");

    expect(architecture).toContain(
      "summary, PR Risk Ledger, schema, runtime, or contract-doc alignment"
    );
    expect(compatibility).toContain("schemas/pr-risk-ledger.v1.json");
    expect(compatibility).toContain("PR Risk Ledger schema/docs");
    expect(compatibility).toContain("summary or PR Risk Ledger contract edits");
    expect(compatibility).toContain("Remaining Follow-ups");
    expect(compatibility).toContain("release provenance artifacts and SBOM publication");
    expect(compatibility).not.toContain(
      "Correctness bugs in config loading, trend handling, action path resolution, and case-study ROI calculation"
    );
    expect(compatibility).not.toContain("Automated schema/doc/runtime drift detection");
    expect(qualityGate).toContain("Check summary and PR Risk Ledger contracts");
  });
});
