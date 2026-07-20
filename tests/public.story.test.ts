import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public story surface", () => {
  it("keeps the Pages entry focused on use cases, proof, and adoption", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain("<title>Web Quality Gatekeeper | Release evidence for web teams</title>");
    expect(source).toContain("One clear answer before a web change ships.");
    expect(source).toContain('id="use-cases"');
    expect(source).toContain('id="workflow"');
    expect(source).toContain('id="evidence"');
    expect(source).toContain('id="start"');
    expect(source).toContain("Fixture result");
    expect(source).toContain("proof/fixture-report.html");
    expect(source).toContain("proof/fixture-summary.v2.json");
    expect(source).toContain("proof/fixture-action-plan.md");
    expect(source).toContain("proof/fixture-pr-risk-ledger.md");
    expect(source).toContain("proof/fixture-lighthouse.json");
    expect(source).toContain('src="assets/brand-mark.svg"');
    expect(source).toContain('src="assets/fixture-home.png"');
    expect(source).toContain('aria-label="GitHub Action example"');
    expect(source).toContain('aria-label="Source checkout example"');
    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("npm run engines:check");
    expect(source).toContain("npx playwright install chromium");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("href=\"roadmap.md\"");
    expect(source).not.toContain("href=\"provenance.md\"");
    expect(source).not.toContain("href=\"sbom.md\"");
  });

  it("keeps the visible sample metrics aligned with the proof fixture", () => {
    const source = readRepoFile("docs/index.html");
    const proof = JSON.parse(readRepoFile("docs/proof/fixture-summary.v2.json")) as {
      durationMs: number;
      pages: Array<{
        details?: {
          performance?: { metrics?: { performanceScore?: number } };
          a11y?: { violations?: number };
          screenshots?: unknown[];
        };
      }>;
    };

    const details = proof.pages[0]?.details;
    const duration = (proof.durationMs / 1000).toFixed(1);
    const performance = details?.performance?.metrics?.performanceScore?.toFixed(2);
    const screenshots = details?.screenshots?.length;
    const violations = details?.a11y?.violations;

    expect(source).toContain(`Runtime: ${duration} s`);
    expect(source).toContain(`Lighthouse performance</span><strong>${performance}</strong>`);
    expect(source).toContain(`Accessibility violations</span><strong>${violations}</strong>`);
    expect(source).toContain(`Captured screenshots</span><strong>${screenshots}</strong>`);
  });

  it("keeps the README short enough to scan and complete enough to use", () => {
    const readme = readRepoFile("README.md");

    expect(readme.length).toBeLessThan(15000);
    expect(readme).toContain("# Web Quality Gatekeeper");
    expect(readme).toContain("## When it helps");
    expect(readme).toContain("## Start with the GitHub Action");
    expect(readme).toContain("## Run it from a source checkout");
    expect(readme).toContain("## What a run produces");
    expect(readme).toContain("## Configure the checks");
    expect(readme).toContain("## Development");
    expect(readme).toContain('src="assets/how-it-works.svg"');
    expect(readme).toContain('src="assets/report-screenshot.png"');
    expect(readme).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(readme).toContain("node dist/cli.js audit https://your-site.example --policy marketing");
    expect(readme).toContain("npm run validate:full");
    expect(readme).toContain("docs/engineering/ARCHITECTURE_MAP.md");
    expect(readme).toContain("docs/testing-matrix.md");
    expect(readme).not.toContain("## Table of Contents");
  });

  it("publishes the proof files linked from the public surface", () => {
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

  it("keeps published proof artifacts free of local paths", () => {
    const report = readRepoFile("docs/proof/fixture-report.html");
    const summary = readRepoFile("docs/proof/fixture-summary.v2.json");
    const lighthouse = readRepoFile("docs/proof/fixture-lighthouse.json");
    const riskLedger = readRepoFile("docs/proof/fixture-pr-risk-ledger.json");
    const combined = `${report}\n${summary}\n${lighthouse}\n${riskLedger}`;

    expect(combined).not.toMatch(/http:\/\/127\.0\.0\.1/i);
    expect(combined).not.toMatch(/\b127\.0\.0\.1\b/i);
    expect(combined).not.toMatch(/localhost[:/]/i);
    expect(combined).not.toMatch(/C:\\Users\\/i);
    expect(combined).not.toMatch(/\/Users\//);
    expect(combined).not.toMatch(/file:\/\//i);
  });
});
