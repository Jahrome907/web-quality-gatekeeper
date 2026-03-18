import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW_FILES = [
  ".github/workflows/action-smoke.yml",
  ".github/workflows/npm-pack-smoke.yml",
  ".github/workflows/npm-publish.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/quality-gate.yml",
  ".github/workflows/release.yml",
  "examples/consumer-workflow.yml",
  "action.yml"
];

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("workflow invariants", () => {
  it("pins repo-owned external GitHub Actions to immutable SHAs", () => {
    const usesPattern = /^\s*uses:\s+([^\s#]+)(?:\s+#.*)?$/gm;

    for (const relativePath of WORKFLOW_FILES) {
      const source = readRepoFile(relativePath);
      const matches = Array.from(source.matchAll(usesPattern));
      const externalUses = matches
        .map((match) => match[1])
        .filter(
          (value): value is string =>
            typeof value === "string" &&
            !value.startsWith("./") &&
            value !== "Jahrome907/web-quality-gatekeeper@v3"
        );

      expect(
        externalUses,
        `${relativePath} contains unpinned external actions`
      ).toSatisfy((values: string[]) => values.every((value) => /@[0-9a-f]{40}$/.test(value)));
    }
  });

  it("guards stable major tag movement behind a stable semver check", () => {
    const source = readRepoFile(".github/workflows/release.yml");

    expect(source).toContain("Resolve major tag update eligibility");
    expect(source).toContain("^v([0-9]+)\\.[0-9]+\\.[0-9]+(\\+[0-9A-Za-z.-]+)?$");
    expect(source).toContain("if: steps.major-tag.outputs.should_update == 'true'");
  });

  it("keeps PR summary comments fork-safe and permission-tolerant", () => {
    const source = readRepoFile(".github/workflows/quality-gate.yml");

    expect(source).toContain("Determine PR comment capability");
    expect(source).toContain("steps.pr_comment.outputs.can_comment == 'true'");
    expect(source).toContain("continue-on-error: true");
    expect(source).toContain("Skipping PR comment due to token permission limits");
  });

  it("keeps repo quality-gate audits hermetic by preferring local docs preview targets", () => {
    const source = readRepoFile(".github/workflows/quality-gate.yml");

    expect(source).toContain("if (hasDocsPreview && (eventName === 'pull_request' || eventName === 'push'))");
    expect(source).toContain("mode=docs_preview");
    expect(source).toContain("mode=docs_preview\\nurl=http://127.0.0.1:4173/");
    expect(source).toContain("docs/index.html");
    expect(source).toContain("python3 -m http.server 4173 --bind 127.0.0.1 --directory docs");
    expect(source).toContain('CONFIG_PATH="configs/default.json"');
    expect(source).toContain('CONFIG_PATH="configs/docs-preview.ci.json"');
    expect(source).toContain('if [ "$TARGET_MODE" = "remote" ] && as_bool "${WQG_RELAXED_REMOTE:-}"; then');
    expect(source).toContain('if [ "$TARGET_MODE" = "demo" ] || [ "$TARGET_MODE" = "docs_preview" ]; then');
    expect(source.indexOf("if (hasDocsPreview && (eventName === 'pull_request' || eventName === 'push'))")).toBeLessThan(
      source.indexOf("} else if (hasDemo) {")
    );
  });

  it("keeps action smoke coverage for relative policy handling and rich artifact assertions", () => {
    const source = readRepoFile(".github/workflows/action-smoke.yml");

    expect(source).toContain("policy: tests/fixtures/policies/action-relative-policy.json");
    expect(source).toContain("WQG_ACTION_SUMMARY_PATH");
    expect(source).toContain("node scripts/ci/assert-action-smoke.mjs");
  });

  it("keeps least-privilege token permissions in smoke workflows", () => {
    const actionSmoke = readRepoFile(".github/workflows/action-smoke.yml");
    const packSmoke = readRepoFile(".github/workflows/npm-pack-smoke.yml");

    expect(actionSmoke).toContain("permissions:");
    expect(actionSmoke).toContain("contents: read");
    expect(packSmoke).toContain("permissions:");
    expect(packSmoke).toContain("contents: read");
  });

  it("hardens composite action checkout by disabling credential persistence", () => {
    const source = readRepoFile("action.yml");

    expect(source).toContain("- name: Checkout");
    expect(source).toContain("persist-credentials: false");
    expect(source).toContain("Install Playwright browsers (Linux)");
    expect(source).toContain("if: runner.os == 'Linux'");
    expect(source).toContain("npx playwright install --with-deps chromium");
    expect(source).toContain("Install Playwright browsers (macOS/Windows)");
    expect(source).toContain("if: runner.os != 'Linux'");
    expect(source).toContain("npx playwright install chromium");
  });

  it("keeps npm pack smoke coverage on a cross-platform matrix", () => {
    const source = readRepoFile(".github/workflows/npm-pack-smoke.yml");

    expect(source).toContain("matrix:");
    expect(source).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(source).toContain("Install Playwright browsers");
    expect(source).toContain("npx playwright install --with-deps chromium");
    expect(source).toContain("if: runner.os == 'Linux'");
    expect(source).toContain("if: runner.os != 'Linux'");
    expect(source).toContain("npx playwright install chromium");
    expect(source).toContain("Run package smoke");
    expect(source).toContain("npm run smoke:pack");
  });

  it("keeps npm publish workflow as a manual backfill path only", () => {
    const source = readRepoFile(".github/workflows/npm-publish.yml");

    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("release_tag:");
    expect(source).toContain("ref: ${{ inputs.release_tag }}");
    expect(source).toContain("Smoke test packed tarball");
    expect(source).toContain("npm run smoke:pack");
    expect(source).toContain("Enforce requested tag and package version parity");
    expect(source).toContain("release_tag must be a semantic version tag");
    expect(source).toContain("does not match package.json version tag");
    expect(source).toContain("Require maintainer publish token for emergency backfill");
    expect(source).toContain("Configure npm auth token");
    expect(source).toContain("Publish to npm with token fallback");
    expect(source).toContain("HAS_NPM_TOKEN: ${{ secrets.NPM_TOKEN != '' }}");
    expect(source).toContain("node-version: 24");
    expect(source).toContain("Trusted publishing requires Node 22.14.0 or later.");
    expect(source).toContain("Trusted publishing requires npm 11.5.1 or later.");
    expect(source).not.toContain("types: [published]");
    expect(source).not.toContain("github.event.release.tag_name");
    expect(source).not.toContain("Publish to npm with trusted publishing");
  });

  it("keeps release workflow as the primary publish path", () => {
    const source = readRepoFile(".github/workflows/release.yml");
    const trustedPublishIndex = source.indexOf("Publish to npm with trusted publishing");
    const tokenPublishIndex = source.indexOf("Publish to npm with token fallback");
    const releaseIndex = source.indexOf("Create GitHub release");
    const majorTagIndex = source.indexOf("Update major version tag");

    expect(source).toContain("Enforce tag and package version parity");
    expect(source).toContain("Ensure package version is unpublished");
    expect(source).toContain("Configure npm auth token fallback");
    expect(source).toContain("Configure npm registry for trusted publishing");
    expect(source).toContain("Verify trusted publishing runtime");
    expect(source).toContain("npm publish --provenance --access public");
    expect(source).toContain("HAS_NPM_TOKEN: ${{ secrets.NPM_TOKEN != '' }}");
    expect(source).toContain("node-version: 24");
    expect(source).toContain("Trusted publishing requires Node 22.14.0 or later.");
    expect(source).toContain("Trusted publishing requires npm 11.5.1 or later.");
    expect(source).toContain("if: env.HAS_NPM_TOKEN != 'true'");
    expect(source).toContain("if: env.HAS_NPM_TOKEN == 'true'");
    expect(trustedPublishIndex).toBeGreaterThanOrEqual(0);
    expect(tokenPublishIndex).toBeGreaterThanOrEqual(0);
    expect(releaseIndex).toBeGreaterThanOrEqual(0);
    expect(majorTagIndex).toBeGreaterThanOrEqual(0);
    expect(trustedPublishIndex).toBeLessThan(releaseIndex);
    expect(tokenPublishIndex).toBeLessThan(releaseIndex);
    expect(releaseIndex).toBeLessThan(majorTagIndex);
  });

  it("uses maintainer helper commands in validation-heavy workflows", () => {
    const qualityGate = readRepoFile(".github/workflows/quality-gate.yml");
    const release = readRepoFile(".github/workflows/release.yml");

    expect(qualityGate).toContain("Run full maintainer validation");
    expect(qualityGate).toContain("npm run validate:full");
    expect(release).toContain("Run release consumer smoke");
    expect(release).toContain("npm run release:dry-run");
  });

  it("keeps the published consumer workflow aligned with repo pinning policy", () => {
    const source = readRepoFile("examples/consumer-workflow.yml");

    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(source).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
  });

  it("disables blank issues and routes security reports to private channels", () => {
    const source = readRepoFile(".github/ISSUE_TEMPLATE/config.yml");

    expect(source).toContain("blank_issues_enabled: false");
    expect(source).toContain("/security/advisories/new");
    expect(source).toContain("/blob/main/SECURITY.md");
  });

  it("keeps contributor workflows focused on verifiable repo behavior", () => {
    const contributing = readRepoFile("CONTRIBUTING.md");
    const prTemplate = readRepoFile(".github/pull_request_template.md");

    expect(contributing).toContain(
      "Keep submitted code, docs, and artifacts directly verifiable through the repo's tests, smoke checks, or published proof surfaces."
    );
    expect(prTemplate).toContain("I confirmed the docs, examples, and emitted artifacts still match actual repo behavior");
    expect(contributing).not.toMatch(/\bAI-generated\b/i);
    expect(prTemplate).not.toMatch(/\bAI-generated\b/i);
  });
});
