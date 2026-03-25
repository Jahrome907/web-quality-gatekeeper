import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "case-study", "run-fixture-case-study.mjs");
const CLI_ENTRY_FRAGMENT = path.join("src", "cli.ts");

async function hideFile(filePath: string): Promise<() => Promise<void>> {
  if (!existsSync(filePath)) {
    return async () => {};
  }

  const hiddenPath = `${filePath}.wqg-hidden-${Date.now()}-${process.pid}`;
  await rename(filePath, hiddenPath);
  return async () => {
    if (existsSync(hiddenPath)) {
      await rename(hiddenPath, filePath);
    }
  };
}

describe("fixture case-study happy path", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("runs the scripted fixture path and writes a provenance manifest", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "wqg-case-fixture-"));
    tempDirs.push(outDir);

    const { stdout } = await execFileAsync("node", [SCRIPT_PATH, "--out-dir", outDir], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120000
    });

    expect(stdout).toContain("Fixture case study completed");
    expect(existsSync(path.join(outDir, "artifacts", "report.html"))).toBe(true);
    expect(existsSync(path.join(outDir, "artifacts", "summary.v2.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "fixture-provenance.json"))).toBe(true);

    const manifest = JSON.parse(
      await readFile(path.join(outDir, "fixture-provenance.json"), "utf8")
    ) as {
      kind: string;
      command: string;
      source: { type: string; configPath: string };
      outputs: {
        reportPath: string;
        summaryV2Path: string;
        lighthousePath: string | null;
        actionPlanPath: string | null;
        screenshotPath: string | null;
      };
      result: { overallStatus: string };
    };

    expect(manifest.kind).toBe("fixture-case-study-run");
    expect(manifest.command).toContain(CLI_ENTRY_FRAGMENT);
    expect(manifest.source.type).toBe("local-fixture");
    expect(manifest.source.configPath).toMatch(/tests[\\/]fixtures[\\/]integration-config\.json/);
    expect(manifest.outputs.reportPath).toContain("report.html");
    expect(manifest.outputs.summaryV2Path).toContain("summary.v2.json");
    if (manifest.outputs.lighthousePath) {
      expect(existsSync(path.join(process.cwd(), manifest.outputs.lighthousePath))).toBe(true);
    }
    if (manifest.outputs.actionPlanPath) {
      expect(existsSync(path.join(process.cwd(), manifest.outputs.actionPlanPath))).toBe(true);
    }
    expect(manifest.outputs.screenshotPath).not.toBeNull();
    expect(existsSync(path.join(process.cwd(), manifest.outputs.screenshotPath!))).toBe(true);
    expect(manifest.result.overallStatus).toBe("pass");
  }, 120000);

  it("fails fast for malformed --out-dir usage", async () => {
    await expect(
      execFileAsync("node", [SCRIPT_PATH, "--out-dir"], {
        cwd: process.cwd(),
        encoding: "utf8"
      })
    ).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Missing value for --out-dir")
    });
  });

  it("fails with an actionable error when WQG_CASE_STUDY_USE_DIST=true and dist CLI is missing", async () => {
    const builtCliPath = path.join(process.cwd(), "dist", "cli.js");
    const restoreBuiltCli = await hideFile(builtCliPath);

    try {
      await expect(
        execFileAsync("node", [SCRIPT_PATH], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            WQG_CASE_STUDY_USE_DIST: "true"
          }
        })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("WQG_CASE_STUDY_USE_DIST=true requires a built CLI")
      });
    } finally {
      await restoreBuiltCli();
    }
  });

  it("fails with an actionable error when neither tsx nor dist CLI is available", async () => {
    const builtCliPath = path.join(process.cwd(), "dist", "cli.js");
    const tsxPath = path.join(
      process.cwd(),
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tsx.cmd" : "tsx"
    );
    const restoreBuiltCli = await hideFile(builtCliPath);
    const restoreTsx = await hideFile(tsxPath);

    try {
      await expect(
        execFileAsync("node", [SCRIPT_PATH], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            WQG_CASE_STUDY_USE_DIST: "false"
          }
        })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining("Unable to locate a runnable CLI")
      });
    } finally {
      await restoreTsx();
      await restoreBuiltCli();
    }
  });
});
