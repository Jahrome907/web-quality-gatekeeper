import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const GENERATED_FROM_PATTERN = new RegExp(["Generated", "from"].join("\\s+"));
const GENERATED_FROM_LOWERCASE_PATTERN = new RegExp(["generated", "from"].join("\\s+"));
const GENERATED_BUNDLE_PATTERN = new RegExp(["generated", "bundle"].join("\\s+"));

describe("public story surface", () => {
  it("keeps the Pages entry focused on evidence, adoption, and trust", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain("Published evidence");
    expect(source).toContain("Adopt in 5 minutes");
    expect(source).toContain("Why trust it");
    expect(source).toContain("Inspectable open-source evidence");
    expect(source).toContain("Source fixture:");
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };

    expect(source).toContain(`<strong>Proof bundle version:</strong> ${pkg.version}.`);
    expect(source).toMatch(/<strong>Release source:<\/strong>\s*GitHub\s+tags\s+and\s+Releases/);
    expect(source).toContain("proof/fixture-report.html");
    expect(source).toContain("proof/fixture-summary.v2.json");
    expect(source).toContain("proof/fixture-pr-risk-ledger.json");
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study-run.md"
    );
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study/public-oss-repro.md"
    );
    expect(source).toContain('title="Sample Web Quality Gatekeeper report"');
    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10");
    expect(source).toContain("# v6.0.3");
    expect(source).toContain("baseline-dir: baselines");
    expect(source).toContain('WQG_SENSITIVE_AUDIT: "false"');
    expect(source).toContain('WQG_ALLOW_SENSITIVE_OUTPUTS: "false"');
    expect(source).toContain("actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10");
    expect(source).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(source).toContain("# v7.0.1");
    expect(source).toContain("- id: wqg");
    expect(source).toContain("steps.wqg.outputs.report-path");
    expect(source).toContain("steps.wqg.outputs.pr-risk-ledger-md-path");
    expect(source).toMatch(/tabindex="0"\s+aria-label="Source CLI adoption example"/);
    expect(source).toMatch(/tabindex="0"\s+aria-label="GitHub Action adoption example"/);
    expect(source).not.toContain("output-dir: artifacts");
    expect(source).not.toContain("source commit");
    expect(source).not.toMatch(GENERATED_FROM_PATTERN);
  });

  it("keeps Pages branding and labels readable instead of relying on all-caps styling", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain('href="assets/brand-mark.svg"');
    expect(source).toMatch(
      /<span class="brand-mark" aria-hidden="true"\s*>\s*<img src="assets\/brand-mark\.svg"/
    );
    expect(source).not.toContain(">WQG<");
    expect(source).not.toContain("text-transform: uppercase");
    expect(source).not.toContain("letter-spacing");
    expect(source).not.toContain("&mdash;");
  });

  it("keeps Pages proof metrics aligned with the published summary artifact", () => {
    const source = readRepoFile("docs/index.html");
    const proof = JSON.parse(readRepoFile("docs/proof/fixture-summary.v2.json")) as {
      durationMs: number;
    };
    const expectedDurationSeconds = (proof.durationMs / 1000).toFixed(1);

    expect(source).toContain(`${expectedDurationSeconds}&nbsp;s`);
    expect(source).toContain(`"durationMs": ${proof.durationMs}`);
    expect(source).not.toContain("7.6&nbsp;s");
    expect(source).not.toContain('"durationMs": 7621');
  });

  it("links Pages markdown references to GitHub-rendered docs", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/roadmap.md"
    );
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/provenance.md"
    );
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/sbom.md"
    );
    expect(source).not.toContain('href="case-study-run.md"');
    expect(source).not.toContain('href="case-study/public-oss-repro.md"');
    expect(source).not.toContain('href="roadmap.md"');
    expect(source).not.toContain('href="provenance.md"');
    expect(source).not.toContain('href="sbom.md"');
  });

  it("keeps provenance wording focused on traceable repository evidence", () => {
    const source = readRepoFile("docs/provenance.md");

    expect(source).toContain("trace back to repository-owned fixtures");
    expect(source).toContain("proof bundle");
    expect(source).toContain("required screenshot evidence");
    expect(source).toContain("optional Lighthouse payload");
    expect(source).not.toMatch(GENERATED_FROM_LOWERCASE_PATTERN);
    expect(source).not.toMatch(GENERATED_BUNDLE_PATTERN);
  });

  it("keeps README linked to proof artifacts and reproducibility docs", () => {
    const source = readRepoFile("README.md");
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };

    expect(source).toContain("How It Works");
    expect(source).toContain(`source-${pkg.version}`);
    expect(source).toContain("artifacts/action-plan.md");
    expect(source).toContain("PR Risk Ledger artifacts by default");
    expect(source).toContain(
      'src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/how-it-works.svg"'
    );
    expect(source).toContain(
      'src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/report-screenshot.png"'
    );
    expect(source).toContain(
      "Release source of truth: use GitHub tags and Releases for published versions."
    );
    expect(source).toContain('WQG_SENSITIVE_AUDIT: "false"');
    expect(source).toContain('WQG_ALLOW_SENSITIVE_OUTPUTS: "false"');
    expect(source).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(source).toContain("# v7.0.1");
    expect(source).toContain("- id: wqg");
    expect(source).toContain("steps.wqg.outputs.summary-path");
    expect(source).toContain("steps.wqg.outputs.pr-risk-ledger-md-path");
    expect(source).toContain("Proof & Reproducibility");
    expect(source).toContain("blob/main/docs/proof/fixture-report.html");
    expect(source).toContain("blob/main/docs/proof/fixture-summary.v2.json");
    expect(source).toContain("blob/main/docs/proof/fixture-pr-risk-ledger.json");
    expect(source).toContain("blob/main/docs/proof/fixture-proof-config.json");
    expect(source).toContain("blob/main/docs/case-study-run.md");
    expect(source).toContain("blob/main/docs/case-study/public-oss-repro.md");
    expect(source).toContain("Screenshot paths must be `@target`");
    expect(source).toContain("Protocol-relative paths such as `//example.com/path` are rejected");
  });

  it("keeps default source-checkout user agent examples aligned with the package version", () => {
    const readme = readRepoFile("README.md");
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };
    const defaultConfig = JSON.parse(readRepoFile("configs/default.json")) as {
      playwright?: { userAgent?: string };
    };

    expect(defaultConfig.playwright?.userAgent).toBe(`wqg/${pkg.version}`);
    expect(readme).toContain(`"userAgent": "wqg/${pkg.version}"`);
  });

  it("publishes the proof artifact set referenced by the public docs", () => {
    const requiredFiles = [
      "docs/assets/brand-mark.svg",
      "docs/assets/fixture-home.png",
      "docs/proof/fixture-action-plan.md",
      "docs/proof/fixture-lighthouse.json",
      "docs/proof/fixture-pr-risk-ledger.json",
      "docs/proof/fixture-pr-risk-ledger.md",
      "docs/proof/fixture-proof-config.json",
      "docs/proof/fixture-report.html",
      "docs/proof/fixture-summary.v2.json",
      "docs/proof/screenshots/home.png",
      "docs/proof/screenshots/pricing.png"
    ];

    requiredFiles.forEach((relativePath) => {
      expect(
        existsSync(path.join(process.cwd(), relativePath)),
        `${relativePath} should exist`
      ).toBe(true);
    });
  });

  it("keeps the published proof bundle version aligned with the package version", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };
    const proof = JSON.parse(readRepoFile("docs/proof/fixture-summary.v2.json")) as {
      toolVersion: string;
      pages: Array<{ details?: { toolVersion?: string } }>;
    };
    const prRiskLedger = JSON.parse(readRepoFile("docs/proof/fixture-pr-risk-ledger.json")) as {
      toolVersion: string;
    };

    expect(proof.toolVersion).toBe(pkg.version);
    expect(proof.pages[0]?.details?.toolVersion).toBe(pkg.version);
    expect(prRiskLedger.toolVersion).toBe(pkg.version);
  });

  it("keeps proof fixture config aligned with the published release version", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };
    const config = JSON.parse(readRepoFile("docs/proof/fixture-proof-config.json")) as {
      playwright?: { userAgent?: string };
    };

    expect(config.playwright?.userAgent).toBe(`wqg-proof-fixture/${pkg.version}`);
  });

  it("sanitizes published proof artifacts for OSS distribution", () => {
    const report = readRepoFile("docs/proof/fixture-report.html");
    const summarySource = readRepoFile("docs/proof/fixture-summary.v2.json");
    const lighthouse = readRepoFile("docs/proof/fixture-lighthouse.json");
    const prRiskLedger = readRepoFile("docs/proof/fixture-pr-risk-ledger.json");
    const prRiskLedgerMarkdown = readRepoFile("docs/proof/fixture-pr-risk-ledger.md");
    const summary = JSON.parse(summarySource) as {
      startedAt: string;
      primaryUrl: string;
      pages: Array<{
        url?: string;
        startedAt?: string;
        details?: {
          url?: string;
          startedAt?: string;
          screenshots?: Array<{ url?: string }>;
        };
      }>;
    };
    const combined = `${report}\n${summarySource}\n${lighthouse}\n${prRiskLedger}\n${prRiskLedgerMarkdown}`;

    expect(combined).not.toMatch(/http:\/\/127\.0\.0\.1/i);
    expect(combined).not.toMatch(/\b127\.0\.0\.1\b/i);
    expect(combined).not.toMatch(/localhost[:/]/i);
    expect(combined).not.toMatch(/C:\\Users\\/i);
    expect(combined).not.toMatch(/\/Users\//);
    expect(combined).not.toMatch(/file:\/\//i);

    expect(summary.primaryUrl).toBe("https://fixture.example/");
    expect(summary.startedAt).toBe("2026-05-11T22:00:00.000Z");
    expect(report).toContain(`data-iso="${summary.startedAt}"`);
    expect(summary.pages[0]?.url).toBe("https://fixture.example/");
    expect(summary.pages[0]?.startedAt).toBe("2026-05-11T22:00:00.000Z");
    expect(summary.pages[0]?.details?.url).toBe("https://fixture.example/");
    expect(summary.pages[0]?.details?.startedAt).toBe("2026-05-11T22:00:00.000Z");
    expect(summary.pages[0]?.details?.screenshots?.[0]?.url).toBe("https://fixture.example/");
    expect(summary.pages[0]?.details?.screenshots?.[1]?.url).toBe(
      "https://fixture.example/pricing.html"
    );
  });
});
