import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function createSummary(performanceScores: number[], lcpValues: number[]) {
  return {
    overallStatus: "pass",
    rollup: {
      failedPages: 0,
      a11yViolations: 0,
      performanceBudgetFailures: 0,
      visualFailures: 0
    },
    pages: performanceScores.map((score, index) => ({
      details: {
        performance: {
          metrics: {
            performanceScore: score,
            lcpMs: lcpValues[index]
          }
        }
      }
    }))
  };
}

describe("case-study ROI extraction", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("aggregates performance metrics across all pages instead of using only the first page", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-roi-"));
    tempDirs.push(dir);

    const baselinePath = path.join(dir, "baseline.json");
    const improvedPath = path.join(dir, "improved.json");

    await writeFile(
      baselinePath,
      JSON.stringify(createSummary([0.9, 0.5], [1800, 3200])),
      "utf8"
    );
    await writeFile(
      improvedPath,
      JSON.stringify(createSummary([0.95, 0.7], [1600, 2400])),
      "utf8"
    );

    const scriptPath = path.join(process.cwd(), "scripts", "case-study", "roi-from-summaries.mjs");
    const { stdout } = await execFileAsync("node", [scriptPath, baselinePath, improvedPath], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    const result = JSON.parse(stdout) as {
      baseline: { performanceScore: number; lcpMs: number };
      improved: { performanceScore: number; lcpMs: number };
      roi: { performanceScoreDelta: number; lcpMsDelta: number };
    };

    expect(result.baseline.performanceScore).toBe(0.7);
    expect(result.baseline.lcpMs).toBe(2500);
    expect(result.improved.performanceScore).toBe(0.825);
    expect(result.improved.lcpMs).toBe(2000);
    expect(result.roi.performanceScoreDelta).toBe(0.125);
    expect(result.roi.lcpMsDelta).toBe(-500);
  });

  it("returns null deltas instead of fabricating zeros when performance metrics are unavailable", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-roi-null-"));
    tempDirs.push(dir);

    const baselinePath = path.join(dir, "baseline.json");
    const improvedPath = path.join(dir, "improved.json");

    await writeFile(
      baselinePath,
      JSON.stringify({
        overallStatus: "pass",
        rollup: {
          failedPages: 0,
          a11yViolations: 0,
          performanceBudgetFailures: 0,
          visualFailures: 0
        },
        pages: [{ details: { performance: null } }]
      }),
      "utf8"
    );
    await writeFile(
      improvedPath,
      JSON.stringify({
        overallStatus: "pass",
        rollup: {
          failedPages: 0,
          a11yViolations: 0,
          performanceBudgetFailures: 0,
          visualFailures: 0
        },
        pages: [{ details: { performance: null } }]
      }),
      "utf8"
    );

    const scriptPath = path.join(process.cwd(), "scripts", "case-study", "roi-from-summaries.mjs");
    const { stdout } = await execFileAsync("node", [scriptPath, baselinePath, improvedPath], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    const result = JSON.parse(stdout) as {
      baseline: { performanceScore: null; lcpMs: null };
      improved: { performanceScore: null; lcpMs: null };
      roi: { performanceScoreDelta: null; lcpMsDelta: null };
    };

    expect(result.baseline.performanceScore).toBeNull();
    expect(result.baseline.lcpMs).toBeNull();
    expect(result.improved.performanceScore).toBeNull();
    expect(result.improved.lcpMs).toBeNull();
    expect(result.roi.performanceScoreDelta).toBeNull();
    expect(result.roi.lcpMsDelta).toBeNull();
  });
});
