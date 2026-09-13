import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("documentation proof", () => {
  it("links Pages Markdown references to GitHub-rendered documentation", () => {
    const source = readRepoFile("docs/index.html");

    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study-run.md"
    );
    expect(source).toContain(
      "https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study/public-oss-repro.md"
    );
    expect(source).not.toContain('href="case-study-run.md"');
    expect(source).not.toContain('href="case-study/public-oss-repro.md"');
  });

  it("publishes the proof artifact set referenced by the public docs", () => {
    const requiredFiles = [
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

  it("keeps the report preview dimensions aligned with the committed PNG", () => {
    const source = readRepoFile("docs/index.html");
    const preview = source.match(
      /<img\s+src="assets\/report-screenshot\.png"[\s\S]*?width="(\d+)"[\s\S]*?height="(\d+)"/
    );
    const image = readFileSync(path.join(process.cwd(), "docs/assets/report-screenshot.png"));

    expect(preview).not.toBeNull();
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(image.readUInt32BE(16)).toBe(Number(preview?.[1]));
    expect(image.readUInt32BE(20)).toBe(Number(preview?.[2]));
  });

  it("keeps historical proof versions consistent across its artifacts", () => {
    const proof = JSON.parse(readRepoFile("docs/proof/fixture-summary.v2.json")) as {
      toolVersion: string;
      pages: Array<{ details?: { toolVersion?: string } }>;
    };
    const prRiskLedger = JSON.parse(readRepoFile("docs/proof/fixture-pr-risk-ledger.json")) as {
      toolVersion: string;
    };

    expect(proof.toolVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(proof.pages.length).toBeGreaterThan(0);
    for (const page of proof.pages) {
      expect(page.details?.toolVersion).toBe(proof.toolVersion);
    }
    expect(prRiskLedger.toolVersion).toBe(proof.toolVersion);
  });

  it("keeps proof fixture config aligned with the recorded evidence version", () => {
    const proof = JSON.parse(readRepoFile("docs/proof/fixture-summary.v2.json")) as {
      toolVersion: string;
    };
    const config = JSON.parse(readRepoFile("docs/proof/fixture-proof-config.json")) as {
      playwright?: { userAgent?: string };
    };

    expect(config.playwright?.userAgent).toBe(`wqg-proof-fixture/${proof.toolVersion}`);
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
