import path from "node:path";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readActionRunBlock } from "../scripts/ci/_shared.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const REQUIRED_FILES = [
  "summary.json",
  "summary.v2.json",
  "report.html",
  "action-plan.md",
  "pr-risk-ledger.json",
  "pr-risk-ledger.md"
];

function resolveBashCommand(): string | null {
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\bin\\bash.exe",
          "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
          "bash"
        ]
      : ["bash"];

  for (const candidate of candidates) {
    if (spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0) {
      return candidate;
    }
  }

  return null;
}

const BASH_COMMAND = resolveBashCommand();
const HAS_BASH = BASH_COMMAND !== null;

function toBashLiteral(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

async function readOutputs(filePath: string): Promise<Map<string, string>> {
  const source = await readFile(filePath, "utf8");
  const outputs = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line) {
      continue;
    }
    const multilineSeparator = line.indexOf("<<");
    if (multilineSeparator !== -1) {
      const name = line.slice(0, multilineSeparator);
      const delimiter = line.slice(multilineSeparator + 2);
      const value: string[] = [];
      index += 1;
      while (index < lines.length && lines[index] !== delimiter) {
        value.push(lines[index]!);
        index += 1;
      }
      if (index === lines.length) {
        throw new Error(`Unterminated multiline GitHub output: ${name}`);
      }
      outputs.set(name, value.join("\n"));
      continue;
    }
    const separator = line.indexOf("=");
    outputs.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return outputs;
}

async function writeStubAudit(actionRoot: string): Promise<void> {
  const cliPath = path.join(actionRoot, "dist", "cli.js");
  const source = `
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outIndex = process.argv.indexOf("--out");
const outDir = process.argv[outIndex + 1];
const scenario = process.env.WQG_TEST_RECEIPT_SCENARIO;
const requiredFiles = ${JSON.stringify(REQUIRED_FILES)};
const generatedFiles = [...requiredFiles, "screenshots/current.png", "trends/history.json"];
mkdirSync(outDir, { recursive: true });
for (const file of generatedFiles) {
  mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
  const contents = file === "summary.json" ? JSON.stringify({ overallStatus: scenario === "current-fail" ? "fail" : "pass" }) : "stub";
  writeFileSync(path.join(outDir, file), contents, "utf8");
}
writeFileSync(path.join(outDir, "unlisted-private.txt"), "private", "utf8");
mkdirSync(path.join(outDir, ".wqg-history"), { recursive: true });
writeFileSync(path.join(outDir, ".wqg-history", "previous.json"), "private", "utf8");
if (scenario !== "absent" && scenario !== "fatal") {
  writeFileSync(
    path.join(outDir, ".wqg-output-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: scenario === "incomplete" ? "incomplete" : "complete",
      runId: scenario === "stale" ? "previous-run" : process.env.WQG_RUN_ID,
      generatedFiles
    }),
    "utf8"
  );
}
process.exit(scenario === "current-fail" ? 1 : scenario === "fatal" ? 3 : 0);
`;
  await mkdir(path.dirname(cliPath), { recursive: true });
  await writeFile(cliPath, source, "utf8");
  if (process.platform !== "win32") {
    await chmod(cliPath, 0o755);
  }
}

async function runReceiptScenario(
  root: string,
  scenario: string,
  options: { headers?: string } = {}
): Promise<{ status: number | null; outputs: Map<string, string>; stderr: string }> {
  const actionRoot = path.join(root, "action");
  const workspace = path.join(root, "workspace");
  const outputPath = path.join(root, `${scenario}-github-output.txt`);
  await writeStubAudit(actionRoot);

  const envPrelude = (
    [
      ["GITHUB_ACTION_PATH", actionRoot],
      ["GITHUB_WORKSPACE", workspace],
      ["GITHUB_OUTPUT", outputPath],
      ["INPUT_URL", "https://example.com"],
      ["INPUT_CONFIG", "configs/default.json"],
      ["INPUT_BASELINE", "baselines"],
      ["INPUT_POLICY", ""],
      ["INPUT_A11Y", "true"],
      ["INPUT_PERF", "true"],
      ["INPUT_VISUAL", "true"],
      ["INPUT_ALLOW_INTERNAL", "false"],
      ["INPUT_HEADERS", options.headers ?? ""],
      ["INPUT_COOKIES", ""],
      ["WQG_TEST_RECEIPT_SCENARIO", scenario]
    ] satisfies Array<[string, string]>
  ).map(([key, value]) => `export ${key}=${toBashLiteral(value)}`);
  const result = spawnSync(BASH_COMMAND!, ["-s"], {
    cwd: ROOT,
    encoding: "utf8",
    input: `${envPrelude.join("\n")}\n${readActionRunBlock()}\n`,
    env: process.env
  });

  return {
    status: result.status,
    outputs: await readOutputs(outputPath),
    stderr: result.stderr
  };
}

describe.skipIf(!HAS_BASH)("composite action output completion receipt", () => {
  it("publishes outputs for completed pass and quality-fail audits", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wqg-action-receipt-"));
    try {
      const pass = await runReceiptScenario(root, "current-pass");
      expect(pass.status).toBe(0);
      expect(pass.outputs.get("sensitive-audit")).toBe("false");
      expect(pass.outputs.get("bundle-complete")).toBe("true");
      expect(pass.outputs.get("status")).toBe("pass");
      expect(pass.outputs.get("summary-path")).toBe("artifacts/summary.json");
      expect(pass.outputs.get("artifact-paths")).toContain("artifacts/screenshots/current.png");
      expect(pass.outputs.get("artifact-paths")).toContain("artifacts/trends/history.json");
      expect(pass.outputs.get("artifact-paths")).not.toContain(".wqg-history");
      expect(pass.outputs.get("artifact-paths")).not.toContain("unlisted-private.txt");

      const qualityFail = await runReceiptScenario(root, "current-fail");
      expect(qualityFail.status).toBe(1);
      expect(qualityFail.outputs.get("sensitive-audit")).toBe("false");
      expect(qualityFail.outputs.get("bundle-complete")).toBe("true");
      expect(qualityFail.outputs.get("status")).toBe("fail");
      expect(qualityFail.outputs.get("report-path")).toBe("artifacts/report.html");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not publish stale or incomplete output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wqg-action-receipt-"));
    try {
      for (const scenario of ["stale", "incomplete", "absent", "fatal"]) {
        const result = await runReceiptScenario(root, scenario);
        expect(result.status).not.toBe(0);
        expect(result.outputs.get("sensitive-audit")).toBe("true");
        expect(result.outputs.get("bundle-complete")).toBe("false");
        expect(result.outputs.get("status")).toBeUndefined();
        expect(result.outputs.get("summary-path")).toBeUndefined();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps completed authenticated audits marked sensitive", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wqg-action-receipt-"));
    try {
      const result = await runReceiptScenario(root, "current-pass", {
        headers: "Authorization: token value"
      });
      expect(result.status).toBe(0);
      expect(result.outputs.get("sensitive-audit")).toBe("true");
      expect(result.outputs.get("bundle-complete")).toBe("true");
      expect(result.outputs.get("status")).toBe("pass");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
