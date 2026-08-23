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
  it("keeps the Pages entry focused on evidence, supported usage, and boundaries", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain("<h1>Web Quality Gatekeeper</h1>");
    expect(source).toContain("<h2>What it checks</h2>");
    expect(source).toContain('<h2 id="install">GitHub Actions</h2>');
    expect(source).toContain("Authenticated and internal audits can contain sensitive page content");
    expect(source).toContain(
      'href="https://github.com/Jahrome907/web-quality-gatekeeper/releases"'
    );
    expect(source).toContain("proof/fixture-report.html");
    expect(source).toContain("proof/fixture-summary.v2.json");
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study-run.md"
    );
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study/public-oss-repro.md"
    );
    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10");
    expect(source).toContain("# v6.0.3");
    expect(source).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(source).toContain("# v7.0.1");
    expect(source).toContain("- id: wqg");
    expect(source).toContain("steps.wqg.outputs.report-path");
    expect(source).toContain("steps.wqg.outputs.sensitive-audit");
    expect(source).toContain("<code>policy</code> input is");
    expect(source).toContain("Contract-checked JSON formats");
    expect(source).toContain("covered by versioned schemas and contract tests");
    expect(source).not.toMatch(
      /url:\s+https:\/\/your-site\.example(?:\.com)?\s*\r?\n\s+policy:\s+marketing/
    );
    expect(source).toMatch(/tabindex="0"\s+aria-label="GitHub Action usage example"/);
    expect(source).toContain("Version 3.2.3 is not published");
    expect(source).not.toContain("wqg audit https://your-site.example");
    expect(source).not.toMatch(GENERATED_FROM_PATTERN);
  });

  it("keeps the static Pages surface semantic and free of dashboard framing", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain('<a class="skip-link" href="#main">');
    expect(source).toContain('<main id="main" class="container" tabindex="-1">');
    expect(source).toContain('aria-label="Project availability"');
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).toContain("max-inline-size: 100%");
    expect(source).toContain("overflow: auto");
    expect(source).toContain("main:focus { outline: 2px solid var(--link)");
    expect(source).toContain("nav a { display: inline-flex; min-block-size: 32px");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("metric-row");
    expect(source).not.toContain("dashboard");
  });

  it("keeps Pages branding and labels readable instead of relying on a generic mark", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain('<a class="brand" href="#main">Web Quality Gatekeeper</a>');
    expect(source).not.toContain("brand-mark.svg");
    expect(source).not.toContain(">WQG<");
    expect(source).not.toContain("&mdash;");
  });

  it("keeps the report preview explicit, responsive, and linked to committed proof", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain('src="assets/report-screenshot.png"');
    expect(source).toContain('width="2313"');
    expect(source).toContain('height="1098"');
    expect(source).toContain('loading="lazy"');
    expect(source).toContain("proof/fixture-report.html");
    expect(source).toContain("proof/fixture-summary.v2.json");
  });

  it("links Pages markdown references to GitHub-rendered docs", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study-run.md"
    );
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study/public-oss-repro.md"
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

  it("keeps README linked to adoption, proof, and reproducibility surfaces", () => {
    const source = readRepoFile("README.md");

    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("Contract-checked JSON formats are covered by versioned schemas");
    expect(source).toContain("The `policy` input is optional");
    expect(source).toContain("tools/python/README.md");
    expect(source).toContain(
      "- Multi-page rollups\n- Trend history\n- Prioritized remediation\n- PR risk summaries"
    );
    expect(source).not.toMatch(
      /url:\s+https:\/\/your-site\.example(?:\.com)?\s*\r?\n\s+policy:\s+marketing/
    );
    expect(source).toContain("Version `3.2.3` is not published to npm");
    expect(source).toContain("On successful runs, `node dist/cli.js audit` writes artifact files");
    expect(source).toContain("steps.wqg.outputs.sensitive-audit");
    expect(source).toContain("docs/case-study-run.md");
    expect(source).toContain("docs/case-study/public-oss-repro.md");
    expect(source).toContain("fixture-report.html");
    expect(source).toContain("fixture-summary.v2.json");
    expect(source).toContain("fixture-pr-risk-ledger.json");
    expect(source).toContain("Screenshot paths must be `@target`");
    expect(source).toContain("protocol-relative paths such as `//example.com/path` are rejected");
    expect(source).not.toMatch(/source-[0-9]+\.[0-9]+\.[0-9]+/);
  });

  it("publishes the proof artifact set referenced by the public docs", () => {
    const requiredFiles = [
      "docs/assets/fixture-home.png",
      "docs/assets/report-screenshot.png",
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

  it("publishes the report preview as a dimensionally correct PNG", () => {
    const image = readFileSync(path.join(process.cwd(), "docs/assets/report-screenshot.png"));

    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(2313);
    expect(image.readUInt32BE(20)).toBe(1098);
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
