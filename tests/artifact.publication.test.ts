import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildConsumerWorkflow } from "../src/init/templates.js";

const root = path.resolve(import.meta.dirname, "..");
const sources = [
  ["scaffold", buildConsumerWorkflow()],
  ...["README.md", "examples/consumer-workflow.yml", "docs/index.html"].map((file) => [
    file,
    readFileSync(path.join(root, file), "utf8").replaceAll("&amp;", "&")
  ])
];

describe("artifact publication", () => {
  for (const [name, source] of sources) {
    it(`${name} requires completion even when sensitive publication is enabled`, () => {
      const condition = source!
        .split("\n")
        .find((line) => line.includes("if: always()"))!
        .split("if: ")[1]!;
      for (const complete of ["true", "false", ""]) {
        for (const sensitive of ["true", "false", ""]) {
          for (const override of ["true", "false"]) {
            const expression = condition
              .replaceAll("always()", "true")
              .replaceAll("steps.wqg.outputs.bundle-complete", JSON.stringify(complete))
              .replaceAll("steps.wqg.outputs.sensitive-audit", JSON.stringify(sensitive))
              .replaceAll("env.WQG_ALLOW_SENSITIVE_OUTPUTS", JSON.stringify(override));
            const actual = runInNewContext(expression, {}, { timeout: 100 });
            expect(actual).toBe(
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
