import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- Vitest executes the ESM helper directly from source.
import { readActionRunBlock } from "../scripts/ci/_shared.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const HAS_ACTION_BASH =
  spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("bash", ["-lc", "command -v node >/dev/null 2>&1"], { stdio: "ignore" }).status === 0;

function toBashLiteral(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getActionRunPrelude(): string {
  const runBlock = readActionRunBlock();
  const lines = runBlock.split("\n");
  const commandIndex = lines.findIndex(
    (line: string) =>
      line.includes('node "${GITHUB_ACTION_PATH}/dist/cli.js"') && line.includes("audit")
  );

  if (commandIndex === -1) {
    throw new Error("Failed to extract composite action run prelude for policy resolution test.");
  }

  return lines.slice(0, commandIndex).join("\n").trimEnd();
}

function resolvePolicyReference(inputPolicy: string): string {
  const prelude = getActionRunPrelude();
  const envPrelude = ([
    ["GITHUB_WORKSPACE", "/tmp/wqg-workspace"],
    ["GITHUB_ACTION_PATH", "/tmp/wqg-action"],
    ["INPUT_URL", "https://example.com"],
    ["INPUT_CONFIG", "configs/default.json"],
    ["INPUT_BASELINE", "baselines"],
    ["INPUT_POLICY", inputPolicy],
    ["INPUT_A11Y", "true"],
    ["INPUT_PERF", "true"],
    ["INPUT_VISUAL", "true"],
    ["INPUT_ALLOW_INTERNAL", "false"],
    ["INPUT_HEADERS", ""],
    ["INPUT_COOKIES", ""]
  ] satisfies Array<[string, string]>)
    .map(([key, value]) => `export ${key}=${toBashLiteral(value)}`)
    .join("\n");
  const result = spawnSync("bash", ["-lc", "bash -s"], {
    cwd: ROOT,
    encoding: "utf8",
    input: `set -euo pipefail\n${envPrelude}\n${prelude}\nprintf '%s' "$POLICY_REFERENCE"\n`,
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to resolve action policy reference.");
  }

  return result.stdout.trim();
}

describe.skipIf(!HAS_ACTION_BASH)("composite action policy path resolution", () => {
  it("preserves built-in policy names instead of rewriting them as workspace paths", () => {
    expect(resolvePolicyReference("marketing")).toBe("marketing");
    expect(resolvePolicyReference("policy:docs")).toBe("policy:docs");
  });

  it("resolves non-built-in policy paths relative to GITHUB_WORKSPACE", () => {
    expect(resolvePolicyReference("configs/policies/custom.json")).toBe(
      "/tmp/wqg-workspace/configs/policies/custom.json"
    );
    expect(resolvePolicyReference("policy:configs/policies/custom.json")).toBe(
      "/tmp/wqg-workspace/configs/policies/custom.json"
    );
  });
});
