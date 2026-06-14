import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW_FILES = [
  ".github/workflows/action-smoke.yml",
  ".github/workflows/native-visual-diff.yml",
  ".github/workflows/npm-pack-smoke.yml",
  ".github/workflows/npm-publish.yml",
  ".github/workflows/pages.yml",
  ".github/workflows/quality-gate.yml",
  ".github/workflows/release.yml",
  "examples/consumer-workflow.yml",
  "action.yml"
];

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function expectTextOrder(source: string, orderedText: string[]): void {
  let cursor = -1;
  for (const text of orderedText) {
    const index = source.indexOf(text, cursor + 1);
    expect(index, `Expected ${text} after offset ${cursor}`).toBeGreaterThan(cursor);
    cursor = index;
  }
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

      expect(externalUses, `${relativePath} contains unpinned external actions`).toSatisfy(
        (values: string[]) => values.every((value) => /@[0-9a-f]{40}$/.test(value))
      );
    }
  });

  it("disables persisted credentials on repo workflow checkouts", () => {
    const workflowPaths = WORKFLOW_FILES.filter((relativePath) =>
      relativePath.startsWith(".github/workflows/")
    );
    const checkoutPattern = /uses:\s+actions\/checkout@[0-9a-f]{40}(?:\s+#.*)?/g;

    for (const relativePath of workflowPaths) {
      const source = readRepoFile(relativePath);
      for (const match of source.matchAll(checkoutPattern)) {
        const nextStepIndex = source.indexOf(
          "\n      - name:",
          (match.index ?? 0) + match[0].length
        );
        const checkoutBlock = source.slice(
          match.index ?? 0,
          nextStepIndex === -1 ? source.length : nextStepIndex
        );
        expect(checkoutBlock, `${relativePath} checkout should not persist credentials`).toContain(
          "persist-credentials: false"
        );
      }
    }
  });

  it("guards stable major tag movement behind a stable semver check", () => {
    const source = readRepoFile(".github/workflows/release.yml");

    expect(source).toContain('- "v*.*.*"');
    expect(source).not.toContain('- "v*"');
    expect(source).toContain("Resolve major tag update eligibility");
    expect(source).toContain("^v([0-9]+)\\.[0-9]+\\.[0-9]+(\\+[0-9A-Za-z.-]+)?$");
    expect(source).toContain("if: needs.validate.outputs.should_update_major == 'true'");
    expect(source).toContain(
      "release-major-${{ needs.validate.outputs.major || github.ref_name }}"
    );
    expect(source).toContain('git rev-parse -q --verify "refs/tags/$MAJOR"');
    expect(source).toContain('git tag --points-at "$MAJOR"');
    expect(source).toContain("Refusing to move");
    expect(source).toContain('RELEASE_COMMIT="$(git rev-list -n 1 "${GITHUB_REF_NAME}^{commit}")"');
    expect(source).toContain('git tag -f "$MAJOR" "$RELEASE_COMMIT"');
    expect(source).toContain('"refs/tags/$MAJOR" --force');
  });

  it("keeps PR summary comments fork-safe and permission-tolerant", () => {
    const source = readRepoFile(".github/workflows/quality-gate.yml");

    expect(source).toContain("Determine PR comment capability");
    expect(source).toContain("steps.pr_comment.outputs.can_comment == 'true'");
    expect(source).toContain("pr-comment:");
    expect(source).toContain("needs.quality-gate.outputs.can_comment == 'true'");
    expect(source).toContain("issues: write");
    expect(source).toContain("continue-on-error: true");
    expect(source).toContain("Skipping PR comment due to token permission limits");
    expect(source).toContain("function escapeMarkdownText(value)");
    expect(source).toContain("crypto.randomUUID()");
    expect(source).toContain("escapeMarkdownText(worstPerfPage.name)");
    expect(source).not.toContain("body<<WQG_COMMENT");
    expect(source).not.toContain("pull-requests: write");
  });

  it("keeps repo quality-gate audits hermetic by preferring local docs preview targets", () => {
    const source = readRepoFile(".github/workflows/quality-gate.yml");

    expect(source).toContain(
      "if (hasDocsPreview && (eventName === 'pull_request' || eventName === 'push'))"
    );
    expect(source).toContain("mode=docs_preview");
    expect(source).toContain("mode=docs_preview\\nurl=http://127.0.0.1:4173/");
    expect(source).toContain("docs/index.html");
    expect(source).toContain("python3 -m http.server 4173 --bind 127.0.0.1 --directory docs");
    expect(source).toContain('CONFIG_PATH="configs/default.json"');
    expect(source).toContain('CONFIG_PATH="configs/docs-preview.ci.json"');
    expect(source).toContain(
      'if [ "$TARGET_MODE" = "remote" ] && as_bool "${WQG_RELAXED_REMOTE:-}"; then'
    );
    expect(source).toContain(
      'if [ "$TARGET_MODE" = "demo" ] || [ "$TARGET_MODE" = "docs_preview" ]; then'
    );
    expect(
      source.indexOf(
        "if (hasDocsPreview && (eventName === 'pull_request' || eventName === 'push'))"
      )
    ).toBeLessThan(source.indexOf("} else if (hasDemo) {"));
  });

  it("keeps action smoke coverage for relative policy handling and rich artifact assertions", () => {
    const source = readRepoFile(".github/workflows/action-smoke.yml");
    const actionSource = readRepoFile("action.yml");
    const assertionSource = readRepoFile("scripts/ci/assert-action-smoke.mjs");
    const localSmokeSource = readRepoFile("scripts/ci/local-action-smoke.mjs");
    const actionOutputNames = [
      "summary-path",
      "summary-v2-path",
      "report-path",
      "action-plan-path",
      "pr-risk-ledger-path",
      "pr-risk-ledger-md-path"
    ];

    expect(source).toContain("policy: tests/fixtures/policies/action-relative-policy.json");
    expect(source).toContain("WQG_ACTION_SUMMARY_PATH");
    expect(source).toContain("node scripts/ci/assert-action-smoke.mjs");
    for (const outputName of actionOutputNames) {
      expect(actionSource).toContain(`${outputName}:`);
      expect(actionSource).toContain(`echo "${outputName}=artifacts/`);
      expect(source).toContain(`steps.wqg.outputs.${outputName}`);
    }
    expect(localSmokeSource).toContain("schemaRoot: actionRoot");
    expect(localSmokeSource).toContain(
      'assertOutput(outputs, "summary-v2-path", "artifacts/summary.v2.json")'
    );
    expect(localSmokeSource).toContain(
      'assertOutput(outputs, "pr-risk-ledger-md-path", "artifacts/pr-risk-ledger.md")'
    );
    expect(assertionSource).toContain("WQG_ACTION_SUMMARY_V2_PATH");
    expect(assertionSource).toContain("WQG_ACTION_PR_RISK_LEDGER_MD_PATH");
    expect(assertionSource).toContain("pr-risk-ledger.json");
    expect(assertionSource).toContain("pr-risk-ledger.md");
    expect(assertionSource).toContain("schemas/pr-risk-ledger.v1.json");
    expect(assertionSource).toContain(
      "Expected summary.v2 artifacts to point at PR Risk Ledger outputs"
    );
  });

  it("keeps least-privilege token permissions in smoke workflows", () => {
    const actionSmoke = readRepoFile(".github/workflows/action-smoke.yml");
    const packSmoke = readRepoFile(".github/workflows/npm-pack-smoke.yml");

    expect(actionSmoke).toContain("permissions:");
    expect(actionSmoke).toContain("contents: read");
    expect(packSmoke).toContain("permissions:");
    expect(packSmoke).toContain("contents: read");
  });

  it("keeps the composite action self-contained without checkout credentials", () => {
    const source = readRepoFile("action.yml");

    expect(source).not.toContain("actions/checkout");
    expect(source).not.toContain("persist-credentials");
    expect(source).toContain(
      [
        "    - name: Setup Node",
        "      uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0",
        "      with:",
        "        node-version: 24"
      ].join("\n")
    );
    expect(source).toContain(
      [
        "    - name: Check Node engine",
        "      working-directory: ${{ github.action_path }}",
        "      shell: bash",
        "      run: npm run engines:check"
      ].join("\n")
    );
    expect(source).toContain(
      [
        "    - name: Install dependencies",
        "      working-directory: ${{ github.action_path }}",
        "      shell: bash",
        "      run: npm ci --ignore-scripts"
      ].join("\n")
    );
    expectTextOrder(source, ["- name: Check Node engine", "run: npm ci --ignore-scripts"]);
    expect(source).not.toContain("cache: npm");
    expect(source).not.toContain("cache-dependency-path:");
    expect(source).toContain("- name: Resolve Chrome path");
    expect(source).toContain("run: node scripts/ci/resolve-chrome-path.mjs");
    expect(source).toContain("Install Playwright browsers (Linux)");
    expect(source).toContain("if: env.CHROME_PATH == '' && runner.os == 'Linux'");
    expect(source).toContain('PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"');
    expect(source).toContain("npx playwright install --with-deps --only-shell chromium");
    expect(source).toContain("Install Playwright browsers (macOS/Windows)");
    expect(source).toContain("if: env.CHROME_PATH == '' && runner.os != 'Linux'");
    expect(source).toContain("npx playwright install --only-shell chromium");
    expect(source).toContain("AUDIT_EXIT=$?");
    expect(source).toContain('if [[ -f "${OUT_DIR}/summary.json" ]]; then');
    expect(source).toContain('exit "$AUDIT_EXIT"');
  });

  it("runs native visual diff smoke when its implementation or smoke script changes", () => {
    const source = readRepoFile(".github/workflows/native-visual-diff.yml");
    const buildSource = readRepoFile("scripts/ci/native-visual-diff-build.mjs");
    const smokeSource = readRepoFile("scripts/ci/native-visual-diff-smoke.mjs");

    expect(source).toContain("Setup Node");
    expect(source).toContain("actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e");
    expect(source).toContain("node-version: 24");
    expect(source).toContain("package-manager-cache: false");
    expect(source).toContain("src/runner/nativeVisualDiffSupport.ts");
    expect(source).toContain("scripts/ci/native-visual-diff-build.mjs");
    expect(source).toContain("scripts/ci/native-visual-diff-smoke.mjs");
    expect(source).toContain(
      [
        "      - name: Test native visual diff engine",
        "        timeout-minutes: 10",
        "        run: cargo test --manifest-path native/wqg-visual-diff-native/Cargo.toml --locked"
      ].join("\n")
    );
    expect(source).toContain(
      [
        "      - name: Build native visual diff engine",
        "        timeout-minutes: 10",
        "        run: npm run native:visual-diff:build"
      ].join("\n")
    );
    expect(source).toContain(
      [
        "      - name: Smoke native visual diff binary",
        "        timeout-minutes: 2",
        "        run: npm run native:visual-diff:smoke"
      ].join("\n")
    );
    expect(source).toContain("npm run native:visual-diff:smoke");
    expect(buildSource).toContain("WQG_CARGO_BIN");
    expect(buildSource).toContain("cargo.exe");
    expect(buildSource).toContain('"--locked"');
    expect(smokeSource).toContain("WQG_VISUAL_DIFF_NATIVE_BIN");
    expect(smokeSource).toContain("NATIVE_VISUAL_DIFF_SMOKE_TIMEOUT_MS");
    expect(smokeSource).toContain("timeout: NATIVE_VISUAL_DIFF_SMOKE_TIMEOUT_MS");
    expect(smokeSource).toContain("if (result.error)");
  });

  it("keeps npm pack smoke coverage on a cross-platform matrix", () => {
    const source = readRepoFile(".github/workflows/npm-pack-smoke.yml");

    expect(source).toContain("matrix:");
    expect(source).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
    expect(source).toContain('node: ["22.19", 24]');
    expect(source).toContain("Check Node engine");
    expectTextOrder(source, ["npm run engines:check", "npm ci --ignore-scripts"]);
    expect(source).toContain("node-version: ${{ matrix.node }}");
    expect(source).toContain("Resolve Chrome path");
    expect(source).toContain("node scripts/ci/resolve-chrome-path.mjs");
    expect(source).toContain("Install Playwright browsers");
    expect(source).toContain("timeout-minutes: 10");
    expect(source).toContain('PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "120000"');
    expect(source).toContain("npx playwright install --with-deps --only-shell chromium");
    expect(source).toContain("if: env.CHROME_PATH == '' && runner.os == 'Linux'");
    expect(source).toContain("if: env.CHROME_PATH == '' && runner.os != 'Linux'");
    expect(source).toContain("npx playwright install --only-shell chromium");
    expect(source).toContain("Run package smoke");
    expect(source).toContain("npm run smoke:pack");
  });

  it("keeps npm publish workflow as a manual backfill path only", () => {
    const source = readRepoFile(".github/workflows/npm-publish.yml");
    const topPermissions = source.slice(source.indexOf("permissions:"), source.indexOf("jobs:"));

    expect(source).toContain("workflow_dispatch:");
    expect(source).toContain("release_tag:");
    expect(source).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?(\\+[0-9A-Za-z.-]+)?$");
    expect(source).toContain("validate-input:");
    expect(source).toContain("npm_dist_tag:");
    expect(source).toContain('if [[ "$RELEASE_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+- ]]; then');
    expect(source).toContain('echo "npm_dist_tag=next" >> "$GITHUB_OUTPUT"');
    expect(source).toContain('echo "npm_dist_tag=latest" >> "$GITHUB_OUTPUT"');
    expect(source).not.toContain('if [[ "$RELEASE_TAG" == *-* ]]; then');
    expect(source).toContain("validate-package:");
    expect(source).toContain("ref: refs/tags/${{ inputs.release_tag }}");
    expect(source).toContain("persist-credentials: false");
    expect(source).toContain("Smoke test packed tarball");
    expect(source).toContain("npm run smoke:pack");
    expect(source).toContain("Enforce requested tag and package version parity");
    expect(source).toContain(
      'npm view "web-quality-gatekeeper@${RELEASE_VERSION}" version --registry=https://registry.npmjs.org/'
    );
    expect(source).toContain("web-quality-gatekeeper@${RELEASE_VERSION} is not published yet.");
    expect(source).toContain(
      "Unable to confirm that web-quality-gatekeeper@${RELEASE_VERSION} is unpublished."
    );
    expect(source).toContain("release_tag must be a semantic version tag");
    expect(source).toContain("does not match package.json version tag");
    expect(source).toContain("Upload publish artifact");
    expect(source).toContain("npm pack --ignore-scripts --json > pack.json");
    expect(source).toContain("actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53");
    expect(source).toContain("Configure npm registry");
    expect(source).toContain("needs: [validate-input, validate-package]");
    expect(source).toContain("Publish to npm with trusted publishing");
    expect(source).toContain("NPM_DIST_TAG: ${{ needs.validate-input.outputs.npm_dist_tag }}");
    expect(source).toContain("Unexpected npm dist-tag");
    expect(source).toContain("tarballs=(./npm-package/*.tgz)");
    expect(source).toContain("Expected exactly one packed npm tarball, found ${#tarballs[@]}.");
    expect(source).toContain(
      'npm publish "${tarballs[0]}" --provenance --access public --tag "$NPM_DIST_TAG"'
    );
    expect(source).toContain("package-manager-cache: false");
    expect(source).toContain("node-version: 24");
    expect(source).toContain("node scripts/ci/assert-publish-runtime.mjs");
    expect(source).toContain("id-token: write");
    expect(topPermissions).not.toContain("id-token: write");
    expect(source).not.toContain("types: [published]");
    expect(source).not.toContain("github.event.release.tag_name");
    expect(source).not.toContain("NODE_AUTH_TOKEN");
    expect(source).not.toContain("NPM_TOKEN");
  });

  it("keeps release workflow focused on GitHub Release and stable Action tag publication", () => {
    const source = readRepoFile(".github/workflows/release.yml");
    const guardIndex = source.indexOf("Validate stable major tag movement");
    const releaseIndex = source.indexOf("Create GitHub release");
    const majorTagIndex = source.indexOf("Update major version tag");

    expect(source).toContain("Enforce tag and package version parity");
    expect(source).toContain("Verify release runtime");
    expect(source).toContain("node-version: 24");
    expect(source).toContain("package-manager-cache: false");
    expect(source).toContain("persist-credentials: false");
    expect(source).toContain("contents: read");
    expect(source).toContain("contents: write");
    expect(source).toContain("npm run release:dry-run");
    expect(source).not.toContain("npm publish --provenance --access public");
    expect(source).not.toContain("HAS_NPM_TOKEN");
    expect(source).not.toContain("id-token: write");
    expect(source).not.toContain("Ensure package version is unpublished");
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(releaseIndex).toBeGreaterThanOrEqual(0);
    expect(majorTagIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeLessThan(releaseIndex);
    expect(releaseIndex).toBeLessThan(majorTagIndex);
  });

  it("uses maintainer helper commands in validation-heavy workflows", () => {
    const qualityGate = readRepoFile(".github/workflows/quality-gate.yml");
    const release = readRepoFile(".github/workflows/release.yml");
    const npmPublish = readRepoFile(".github/workflows/npm-publish.yml");
    const publishRuntime = readRepoFile("scripts/ci/assert-publish-runtime.mjs");

    expect(qualityGate).toContain("Run full maintainer validation");
    expect(qualityGate).toContain("Check Node engine");
    expect(qualityGate).toContain("npm run validate:full");
    expectTextOrder(qualityGate, ["npm run engines:check", "npm ci --ignore-scripts"]);
    expect(qualityGate).not.toContain("Enforce runtime audit gate (high+critical)");
    expect(qualityGate).not.toContain("run: npm run security:audit");
    expect(release).toContain("Run release consumer smoke");
    expectTextOrder(release, ["npm run engines:check", "npm ci --ignore-scripts"]);
    expect(release).toContain("npm run release:dry-run");
    expectTextOrder(npmPublish, [
      "node scripts/ci/assert-publish-runtime.mjs",
      "npm run engines:check",
      "npm ci --ignore-scripts"
    ]);
    expect(npmPublish).toContain("npm run validate:full");
    expect(npmPublish).toContain("npm run contracts:check");
    expect(npmPublish).not.toContain(
      "npm run check\n          npm run security:audit\n          npm run build"
    );
    expect(publishRuntime).toContain("Trusted publishing requires");
    expect(publishRuntime).toContain("resolveNpmCommand");
    expect(publishRuntime).toContain('["--version"]');
  });

  it("keeps the published consumer workflow aligned with repo pinning policy", () => {
    const source = readRepoFile("examples/consumer-workflow.yml");

    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("id: wqg");
    expect(source).toContain("actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd");
    expect(source).toContain("# v6.0.2");
    expect(source).not.toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(source).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(source).toContain("# v7.0.1");
    expect(source).toContain("${{ steps.wqg.outputs.report-path }}");
    expect(source).toContain("${{ steps.wqg.outputs.pr-risk-ledger-md-path }}");
    expect(source).not.toContain(
      "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
    );
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
      "Keep submitted code, docs, and artifacts directly verifiable through the repo's tests, smoke checks, or published evidence."
    );
    expect(prTemplate).toContain(
      "I confirmed the docs, examples, and emitted artifacts still match actual repo behavior"
    );
    expect(prTemplate).toContain("npm run python:smoke");
    expect(prTemplate).toContain("Python analytics behavior");
    expect(contributing).not.toMatch(/\bgenerated-content\b/i);
    expect(prTemplate).not.toMatch(/\bgenerated-content\b/i);
  });
});
