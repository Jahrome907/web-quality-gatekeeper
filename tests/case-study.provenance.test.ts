import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

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

  it("writes a machine-readable manifest with baseline and improved evidence metadata", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-prov-"));
    tempDirs.push(dir);

    const baselineSummaryPath = path.join(dir, "baseline-summary.v2.json");
    const improvedSummaryPath = path.join(dir, "improved-summary.v2.json");
    const baselineReportPath = path.join(dir, "baseline-report.html");
    const improvedReportPath = path.join(dir, "improved-report.html");
    const roiPath = path.join(dir, "roi.json");
    const configPath = path.join(dir, "config.json");
    const outputPath = path.join(dir, "provenance.json");

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
        "--roi-output",
        roiPath,
        "--config",
        configPath,
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
      baseline: { sha: string; pageCount: number; summaryPath: string };
      improved: { sha: string; reportPath: string };
      roiOutput: { path: string; deltas: { failedPagesDelta: number } };
      configPath: string;
    };

    expect(manifest.repoUrl).toBe("https://github.com/example/repo");
    expect(manifest.baseline.sha).toBe("abc1234");
    expect(manifest.baseline.pageCount).toBe(2);
    expect(manifest.baseline.summaryPath).toBe(baselineSummaryPath);
    expect(manifest.improved.sha).toBe("def5678");
    expect(manifest.improved.reportPath).toBe(improvedReportPath);
    expect(manifest.roiOutput.path).toBe(roiPath);
    expect(manifest.roiOutput.deltas.failedPagesDelta).toBe(-1);
    expect(manifest.configPath).toBe(configPath);
  });

  it("fails when required evidence files do not exist", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-prov-missing-"));
    tempDirs.push(dir);

    const summaryPath = path.join(dir, "summary.v2.json");
    const roiPath = path.join(dir, "roi.json");
    const outputPath = path.join(dir, "provenance.json");

    await Promise.all([
      writeFile(summaryPath, JSON.stringify({ overallStatus: "pass", rollup: {} }), "utf8"),
      writeFile(roiPath, JSON.stringify({ roi: {} }), "utf8")
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
          "--roi-output",
          roiPath,
          "--config",
          path.join(dir, "missing-config.json"),
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
