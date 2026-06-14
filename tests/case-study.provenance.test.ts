import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const toPortablePath = (value: string): string => value.replace(/\\/g, "/");

describe("case-study provenance manifest", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("requires repo url and baseline/improved SHAs", async () => {
    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "case-study",
      "write-provenance-manifest.mjs"
    );

    await expect(
      execFileAsync("node", [scriptPath], {
        cwd: process.cwd(),
        encoding: "utf8"
      })
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Missing required flag: --repo-url")
    });
  });

  it("documents the complete public evidence bundle", async () => {
    const protocol = await readFile(
      path.join(process.cwd(), "docs", "case-study", "public-oss-repro.md"),
      "utf8"
    );

    expect(protocol).toContain("--baseline-action-plan");
    expect(protocol).toContain("--improved-action-plan");
    expect(protocol).toContain("--baseline-pr-risk-ledger");
    expect(protocol).toContain("--improved-pr-risk-ledger");
    expect(protocol).toContain("--baseline-pr-risk-ledger-md");
    expect(protocol).toContain("--improved-pr-risk-ledger-md");
    expect(protocol).toContain("artifacts/case-study/baseline/action-plan.md");
    expect(protocol).toContain("artifacts/case-study/improved/pr-risk-ledger.md");
  });

  it("writes a machine-readable manifest with baseline and improved evidence metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-prov-"));
    tempDirs.push(dir);

    const baselineSummaryPath = path.join(dir, "baseline-summary.v2.json");
    const improvedSummaryPath = path.join(dir, "improved-summary.v2.json");
    const baselineReportPath = path.join(dir, "baseline-report.html");
    const improvedReportPath = path.join(dir, "improved-report.html");
    const baselineActionPlanPath = path.join(dir, "baseline-action-plan.md");
    const improvedActionPlanPath = path.join(dir, "improved-action-plan.md");
    const baselineRiskLedgerPath = path.join(dir, "baseline-pr-risk-ledger.json");
    const improvedRiskLedgerPath = path.join(dir, "improved-pr-risk-ledger.json");
    const baselineRiskLedgerMarkdownPath = path.join(dir, "baseline-pr-risk-ledger.md");
    const improvedRiskLedgerMarkdownPath = path.join(dir, "improved-pr-risk-ledger.md");
    const roiPath = path.join(dir, "roi.json");
    const configPath = path.join(dir, "config.json");
    const outputPath = path.join(dir, "provenance.json");
    const baselineCommand = `${path.join(process.cwd(), "node_modules", ".bin", "tsx.cmd")} ${path.join(process.cwd(), "src", "cli.ts")} audit https://baseline.example`;
    const improvedCommand = `${path.join(process.cwd(), "dist", "cli.js")} audit https://improved.example`;

    const summary = {
      overallStatus: "pass",
      primaryUrl: "https://example.com",
      rollup: {
        pageCount: 2,
        failedPages: 0,
        a11yViolations: 1,
        performanceBudgetFailures: 0,
        visualFailures: 0
      }
    };

    await Promise.all([
      writeFile(baselineSummaryPath, JSON.stringify(summary), "utf8"),
      writeFile(improvedSummaryPath, JSON.stringify(summary), "utf8"),
      writeFile(baselineReportPath, "<html>baseline</html>", "utf8"),
      writeFile(improvedReportPath, "<html>improved</html>", "utf8"),
      writeFile(baselineActionPlanPath, "# Baseline action plan\n", "utf8"),
      writeFile(improvedActionPlanPath, "# Improved action plan\n", "utf8"),
      writeFile(baselineRiskLedgerPath, JSON.stringify({ risks: [] }), "utf8"),
      writeFile(improvedRiskLedgerPath, JSON.stringify({ risks: [] }), "utf8"),
      writeFile(baselineRiskLedgerMarkdownPath, "# Baseline PR Risk Ledger\n", "utf8"),
      writeFile(improvedRiskLedgerMarkdownPath, "# Improved PR Risk Ledger\n", "utf8"),
      writeFile(roiPath, JSON.stringify({ roi: { failedPagesDelta: -1 } }), "utf8"),
      writeFile(configPath, "{}", "utf8")
    ]);

    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "case-study",
      "write-provenance-manifest.mjs"
    );

    await execFileAsync(
      "node",
      [
        scriptPath,
        "--repo-url",
        "https://github.com/example/repo",
        "--baseline-sha",
        "abc1234",
        "--improved-sha",
        "def5678",
        "--baseline-summary",
        baselineSummaryPath,
        "--improved-summary",
        improvedSummaryPath,
        "--baseline-report",
        baselineReportPath,
        "--improved-report",
        improvedReportPath,
        "--baseline-action-plan",
        baselineActionPlanPath,
        "--improved-action-plan",
        improvedActionPlanPath,
        "--baseline-pr-risk-ledger",
        baselineRiskLedgerPath,
        "--improved-pr-risk-ledger",
        improvedRiskLedgerPath,
        "--baseline-pr-risk-ledger-md",
        baselineRiskLedgerMarkdownPath,
        "--improved-pr-risk-ledger-md",
        improvedRiskLedgerMarkdownPath,
        "--roi-output",
        roiPath,
        "--config",
        configPath,
        "--baseline-command",
        baselineCommand,
        "--improved-command",
        improvedCommand,
        "--out",
        outputPath
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8"
      }
    );

    const manifest = JSON.parse(await readFile(outputPath, "utf8")) as {
      repoUrl: string;
      baseline: {
        sha: string;
        pageCount: number;
        summaryPath: string;
        actionPlanPath: string;
        prRiskLedgerPath: string;
        command: string;
      };
      improved: {
        sha: string;
        reportPath: string;
        prRiskLedgerMarkdownPath: string;
        command: string;
      };
      roiOutput: { path: string; deltas: { failedPagesDelta: number } };
      configPath: string;
    };

    expect(manifest.repoUrl).toBe("https://github.com/example/repo");
    expect(manifest.baseline.sha).toBe("abc1234");
    expect(manifest.baseline.pageCount).toBe(2);
    expect(manifest.baseline.summaryPath).toBe(toPortablePath(baselineSummaryPath));
    expect(manifest.baseline.actionPlanPath).toBe(toPortablePath(baselineActionPlanPath));
    expect(manifest.baseline.prRiskLedgerPath).toBe(toPortablePath(baselineRiskLedgerPath));
    expect(manifest.baseline.command).toContain("npx tsx src/cli.ts");
    expect(manifest.baseline.command).not.toContain("node_modules");
    expect(manifest.baseline.command).not.toContain(".cmd");
    expect(manifest.baseline.command).not.toContain(process.cwd());
    expect(manifest.baseline.command).not.toContain("\\");
    expect(manifest.improved.sha).toBe("def5678");
    expect(manifest.improved.reportPath).toBe(toPortablePath(improvedReportPath));
    expect(manifest.improved.prRiskLedgerMarkdownPath).toBe(
      toPortablePath(improvedRiskLedgerMarkdownPath)
    );
    expect(manifest.improved.command).toContain("dist/cli.js audit https://improved.example");
    expect(manifest.improved.command).not.toContain(process.cwd());
    expect(manifest.improved.command).not.toContain("\\");
    expect(manifest.roiOutput.path).toBe(toPortablePath(roiPath));
    expect(manifest.roiOutput.deltas.failedPagesDelta).toBe(-1);
    expect(manifest.configPath).toBe(toPortablePath(configPath));
  });

  it("fails when required evidence files do not exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-prov-missing-"));
    tempDirs.push(dir);

    const summaryPath = path.join(dir, "summary.v2.json");
    const roiPath = path.join(dir, "roi.json");
    const outputPath = path.join(dir, "provenance.json");

    await Promise.all([
      writeFile(summaryPath, JSON.stringify({ overallStatus: "pass", rollup: {} }), "utf8"),
      writeFile(path.join(dir, "action-plan.md"), "# Action Plan\n", "utf8"),
      writeFile(path.join(dir, "pr-risk-ledger.json"), JSON.stringify({ risks: [] }), "utf8"),
      writeFile(path.join(dir, "pr-risk-ledger.md"), "# PR Risk Ledger\n", "utf8"),
      writeFile(roiPath, JSON.stringify({ roi: {} }), "utf8"),
      writeFile(path.join(dir, "config.json"), "{}", "utf8")
    ]);

    const scriptPath = path.join(
      process.cwd(),
      "scripts",
      "case-study",
      "write-provenance-manifest.mjs"
    );

    await expect(
      execFileAsync(
        "node",
        [
          scriptPath,
          "--repo-url",
          "https://github.com/example/repo",
          "--baseline-sha",
          "abc1234",
          "--improved-sha",
          "def5678",
          "--baseline-summary",
          summaryPath,
          "--improved-summary",
          summaryPath,
          "--baseline-report",
          path.join(dir, "missing-baseline-report.html"),
          "--improved-report",
          path.join(dir, "missing-improved-report.html"),
          "--baseline-action-plan",
          path.join(dir, "action-plan.md"),
          "--improved-action-plan",
          path.join(dir, "action-plan.md"),
          "--baseline-pr-risk-ledger",
          path.join(dir, "pr-risk-ledger.json"),
          "--improved-pr-risk-ledger",
          path.join(dir, "pr-risk-ledger.json"),
          "--baseline-pr-risk-ledger-md",
          path.join(dir, "pr-risk-ledger.md"),
          "--improved-pr-risk-ledger-md",
          path.join(dir, "pr-risk-ledger.md"),
          "--roi-output",
          roiPath,
          "--config",
          path.join(dir, "config.json"),
          "--out",
          outputPath
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8"
        }
      )
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Missing file for --baseline-report")
    });
  });
});
