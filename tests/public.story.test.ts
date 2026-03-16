import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("public story surface", () => {
  it("keeps the Pages entry focused on proof, adoption, and trust", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain("Proof Surface");
    expect(source).toContain("Adopt In 5 Minutes");
    expect(source).toContain("Why Trust It");
    expect(source).toContain("Inspectable OSS proof surface");
    expect(source).toContain("Proof bundle package version: <strong>3.1.2</strong>.");
    expect(source).toContain("Published releases are tracked by");
    expect(source).toContain("proof/fixture-report.html");
    expect(source).toContain("proof/fixture-summary.v2.json");
    expect(source).toContain("case-study-run.md");
    expect(source).toContain("case-study/public-oss-repro.md");
    expect(source).toContain('title="Sample Web Quality Gatekeeper report"');
    expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v3");
    expect(source).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(source).toContain("baseline-dir: baselines");
    expect(source).toContain('tabindex="0" aria-label="CLI adoption example"');
    expect(source).toContain('tabindex="0" aria-label="GitHub Action adoption example"');
    expect(source).not.toContain("output-dir: artifacts");
    expect(source).not.toContain("source commit");
  });

  it("keeps README linked to proof artifacts and reproducibility docs", () => {
    const source = readRepoFile("README.md");
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };

    expect(source).toContain("How It Works");
    expect(source).toContain(`source-${pkg.version}`);
    expect(source).toContain('src="assets/how-it-works.svg"');
    expect(source).toContain('src="assets/report-screenshot.png"');
    expect(source).toContain("Release source of truth: use GitHub tags and Releases for published versions.");
    expect(source).toContain("Proof & Reproducibility");
    expect(source).toContain("blob/main/docs/proof/fixture-report.html");
    expect(source).toContain("blob/main/docs/proof/fixture-summary.v2.json");
    expect(source).toContain("blob/main/docs/proof/fixture-proof-config.json");
    expect(source).toContain("blob/main/docs/case-study-run.md");
    expect(source).toContain("blob/main/docs/case-study/public-oss-repro.md");
    expect(source).not.toContain("raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/how-it-works.svg");
  });

  it("publishes the proof artifact set referenced by the public docs", () => {
    const requiredFiles = [
      "docs/assets/fixture-home.png",
      "docs/proof/fixture-action-plan.md",
      "docs/proof/fixture-lighthouse.json",
      "docs/proof/fixture-proof-config.json",
      "docs/proof/fixture-report.html",
      "docs/proof/fixture-summary.v2.json",
      "docs/proof/screenshots/home.png"
    ];

    requiredFiles.forEach((relativePath) => {
      expect(existsSync(path.join(process.cwd(), relativePath)), `${relativePath} should exist`).toBe(
        true
      );
    });
  });

  it("keeps the published proof bundle version aligned with the package version", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as { version: string };
    const proof = JSON.parse(readRepoFile("docs/proof/fixture-summary.v2.json")) as {
      toolVersion: string;
      pages: Array<{ details?: { toolVersion?: string } }>;
    };

    expect(proof.toolVersion).toBe(pkg.version);
    expect(proof.pages[0]?.details?.toolVersion).toBe(pkg.version);
  });
});
