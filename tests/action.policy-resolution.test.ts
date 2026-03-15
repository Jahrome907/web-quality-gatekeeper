import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const ACTION_PATH = path.join(ROOT, "action.yml");

function getActionRunPrelude(): string {
  const source = readFileSync(ACTION_PATH, "utf8");
  const match = source.match(
    /run: \|\n([\s\S]*?)\n\s*node "\$\{GITHUB_ACTION_PATH\}\/dist\/cli\.js" audit "\$\{ARGS\[@\]\}"/
  );

  if (!match?.[1]) {
    throw new Error("Failed to extract composite action run prelude for policy resolution test.");
  }

  return match[1];
}

function resolvePolicyReference(inputPolicy: string): string {
  const prelude = getActionRunPrelude();
  const script = `
set -euo pipefail
${prelude}
printf '%s' "$POLICY_REFERENCE"
`;

  return execFileSync("bash", ["-lc", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_WORKSPACE: "/tmp/wqg-workspace",
      GITHUB_ACTION_PATH: "/tmp/wqg-action",
      INPUT_URL: "https://example.com",
      INPUT_CONFIG: "configs/default.json",
      INPUT_BASELINE: "baselines",
      INPUT_POLICY: inputPolicy,
      INPUT_A11Y: "true",
      INPUT_PERF: "true",
      INPUT_VISUAL: "true",
      INPUT_ALLOW_INTERNAL: "false",
      INPUT_HEADERS: "",
      INPUT_COOKIES: ""
    }
  }).trim();
}

describe("composite action policy path resolution", () => {
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
