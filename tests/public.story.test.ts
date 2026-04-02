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
    expect(source).toContain("<strong>Proof bundle version:</strong> 3.1.3.");
    expect(source).toContain("<strong>Release source:</strong> GitHub tags and Releases");
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
    expect(source).toContain(
      'src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/how-it-works.svg"'
    );
    expect(source).toContain(
      'src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/report-screenshot.png"'
    );
    expect(source).toContain("Release source of truth: use GitHub tags and Releases for published versions.");
    expect(source).toContain("Proof & Reproducibility");
    expect(source).toContain("blob/main/docs/proof/fixture-report.html");
    expect(source).toContain("blob/main/docs/proof/fixture-summary.v2.json");
    expect(source).toContain("blob/main/docs/proof/fixture-proof-config.json");
    expect(source).toContain("blob/main/docs/case-study-run.md");
    expect(source).toContain("blob/main/docs/case-study/public-oss-repro.md");
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

  it("sanitizes published proof artifacts for OSS distribution", () => {
    const report = readRepoFile("docs/proof/fixture-report.html");
    const summarySource = readRepoFile("docs/proof/fixture-summary.v2.json");
    const lighthouse = readRepoFile("docs/proof/fixture-lighthouse.json");
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
    const combined = `${report}\n${summarySource}\n${lighthouse}`;

    expect(combined).not.toMatch(/http:\/\/127\.0\.0\.1/i);
    expect(combined).not.toMatch(/\b127\.0\.0\.1\b/i);
    expect(combined).not.toMatch(/localhost[:/]/i);
    expect(combined).not.toMatch(/C:\\Users\\/i);
    expect(combined).not.toMatch(/\/Users\//);
    expect(combined).not.toMatch(/file:\/\//i);

    expect(summary.primaryUrl).toBe("https://fixture.example/");
    expect(summary.startedAt).toBe("2026-03-25T19:00:00.000Z");
    expect(report).toContain(`data-iso="${summary.startedAt}"`);
    expect(summary.pages[0]?.url).toBe("https://fixture.example/");
    expect(summary.pages[0]?.startedAt).toBe("2026-03-25T19:00:00.000Z");
    expect(summary.pages[0]?.details?.url).toBe("https://fixture.example/");
    expect(summary.pages[0]?.details?.startedAt).toBe("2026-03-25T19:00:00.000Z");
    expect(summary.pages[0]?.details?.screenshots?.[0]?.url).toBe("https://fixture.example/");
  });
});
