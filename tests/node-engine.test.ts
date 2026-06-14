import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

async function loadNodeEngineHelpers(): Promise<{
  assertNodeEngine: (version?: string, range?: string) => { ok: boolean; message: string };
  satisfiesMinimumNode: (version: string, range: string) => boolean;
}> {
  return import("../scripts/ci/assert-node-engine.mjs");
}

describe("Node engine preflight", () => {
  it("matches package engine floor semantics", async () => {
    const { satisfiesMinimumNode } = await loadNodeEngineHelpers();

    expect(satisfiesMinimumNode("22.19.0", ">=22.19")).toBe(true);
    expect(satisfiesMinimumNode("22.19.1", ">=22.19")).toBe(true);
    expect(satisfiesMinimumNode("24.0.0", ">=22.19")).toBe(true);
    expect(satisfiesMinimumNode("22.18.9", ">=22.19")).toBe(false);
  });

  it("returns a release-preflight failure for unsupported Node versions", async () => {
    const { assertNodeEngine } = await loadNodeEngineHelpers();

    expect(assertNodeEngine("22.18.9", ">=22.19")).toMatchObject({
      ok: false,
      message:
        "Node.js 22.18.9 does not satisfy package engines.node >=22.19. Use Node.js 22.19 or later before running release validation."
    });
  });

  it("accepts supported Node versions", async () => {
    const { assertNodeEngine } = await loadNodeEngineHelpers();

    expect(assertNodeEngine("24.0.0", ">=22.19")).toMatchObject({
      ok: true,
      message: "Node.js 24.0.0 satisfies >=22.19."
    });
  });

  it("keeps release dry-run gated by the Node engine preflight", async () => {
    const source = await readFile(path.join(ROOT, "scripts", "ci", "release-dry-run.mjs"), "utf8");
    const preflightIndex = source.indexOf("assertNodeEngine()");
    const validationIndex = source.indexOf('args: ["run", "validate:full"]');
    const contractsIndex = source.indexOf('args: ["run", "contracts:check"]');
    const pythonSmokeIndex = source.indexOf('args: ["run", "python:smoke"]');
    const packSmokeIndex = source.indexOf('args: ["run", "smoke:pack"]');
    const actionSmokeIndex = source.indexOf('args: ["run", "smoke:action"]');

    expect(preflightIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeGreaterThan(-1);
    expect(contractsIndex).toBeGreaterThan(-1);
    expect(pythonSmokeIndex).toBeGreaterThan(-1);
    expect(packSmokeIndex).toBeGreaterThan(-1);
    expect(actionSmokeIndex).toBeGreaterThan(-1);
    expect(source).not.toContain('args: ["run", "security:audit"]');
    expect(preflightIndex).toBeLessThan(validationIndex);
    expect(validationIndex).toBeLessThan(contractsIndex);
    expect(contractsIndex).toBeLessThan(pythonSmokeIndex);
    expect(pythonSmokeIndex).toBeLessThan(packSmokeIndex);
    expect(packSmokeIndex).toBeLessThan(actionSmokeIndex);
  });

  it("keeps full maintainer validation gated by the Node engine preflight", async () => {
    const packageJson = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const validateFull = packageJson.scripts?.["validate:full"] ?? "";

    expect(validateFull).toMatch(/^npm run engines:check && /);
    expect(validateFull).toContain("npm run security:audit");
  });
});
