import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildConsumerWorkflow } from "../src/init/templates.js";

const root = path.resolve(import.meta.dirname, "..");
const consumerSources = [
  ["scaffold", buildConsumerWorkflow()],
  ["README", readFileSync(path.join(root, "README.md"), "utf8")],
  ["website", readFileSync(path.join(root, "docs/index.html"), "utf8").replaceAll("&amp;", "&")],
  ["example", readFileSync(path.join(root, "examples/consumer-workflow.yml"), "utf8")]
];

describe("artifact publication", () => {
  for (const [name, source] of consumerSources) {
    it(`${name} publishes only a completed, eligible artifact list`, () => {
      const condition = source!
        .split("\n")
        .find((line) => line.includes("if: always()"))!
        .split("if: ")[1]!;
      expect(source).toContain("uses: Jahrome907/web-quality-gatekeeper@v5");
      expect(source).toContain("path: ${{ steps.wqg.outputs.artifact-paths }}");
      expect(source).not.toContain("path: artifacts/");
      expect(source).toContain("if-no-files-found: error");
      for (const complete of ["true", "false", ""]) {
        for (const sensitive of ["true", "false", ""]) {
          for (const override of ["true", "false"]) {
            const expression = condition
              .replaceAll("always()", "true")
              .replaceAll("steps.wqg.outputs.bundle-complete", JSON.stringify(complete))
              .replaceAll("steps.wqg.outputs.sensitive-audit", JSON.stringify(sensitive))
              .replaceAll("env.WQG_ALLOW_SENSITIVE_OUTPUTS", JSON.stringify(override));
            expect(runInNewContext(expression, {}, { timeout: 100 })).toBe(
              complete === "true" && (sensitive === "false" || override === "true")
            );
          }
        }
      }
    });
  }

  it("gates repository uploads and summary comments on the completed audit step", () => {
    const workflow = readFileSync(path.join(root, ".github/workflows/quality-gate.yml"), "utf8");
    for (const step of ["Upload artifacts", "Prepare PR summary comment"]) {
      const block = workflow.split(`- name: ${step}`)[1]!.split("uses:")[0]!;
      expect(block).toContain("steps.audit.outputs.bundle_complete == 'true'");
    }
    expect(workflow).toContain("receipt.runId === process.env.WQG_RUN_ID");
    expect(workflow).toContain('receipt.status === "complete"');
  });
});
