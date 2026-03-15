/* global console, process */
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export function assertActionSmoke(options = {}) {
  const workspace = options.workspace ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const schemaRoot = options.schemaRoot ?? process.env.GITHUB_ACTION_PATH ?? workspace;
  const summaryPath = options.summaryPath ?? process.env.WQG_ACTION_SUMMARY_PATH ?? "artifacts/summary.json";
  const summaryFile = path.join(workspace, summaryPath);
  const summaryV2File = path.join(workspace, "artifacts", "summary.v2.json");
  const reportFile = path.join(workspace, "artifacts", "report.html");
  const actionPlanFile = path.join(workspace, "artifacts", "action-plan.md");
  const schemaV1File = path.join(schemaRoot, "schemas", "summary.v1.json");
  const schemaV2File = path.join(schemaRoot, "schemas", "summary.v2.json");

  for (const filePath of [summaryFile, summaryV2File, reportFile, actionPlanFile, schemaV1File, schemaV2File]) {
    if (!existsSync(filePath)) {
      throw new Error(`Expected smoke artifact to exist: ${filePath}`);
    }
  }

  const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
  const summaryV2 = JSON.parse(readFileSync(summaryV2File, "utf8"));
  const summarySchemaV1 = JSON.parse(readFileSync(schemaV1File, "utf8"));
  const summarySchemaV2 = JSON.parse(readFileSync(schemaV2File, "utf8"));
  const expectA11ySkipped = options.expectA11ySkipped ?? true;

  if (expectA11ySkipped && summary.steps?.a11y !== "skipped") {
    throw new Error(`Expected summary.steps.a11y to be "skipped", got "${summary.steps?.a11y}"`);
  }
  if (expectA11ySkipped && summary.a11y !== null) {
    throw new Error("Expected summary.a11y to be null when policy disables a11y");
  }
  if (summary.$schema !== summarySchemaV1.properties?.$schema?.const) {
    throw new Error("Expected summary.json $schema to match schemas/summary.v1.json");
  }
  if (summaryV2.$schema !== summarySchemaV2.properties?.$schema?.const) {
    throw new Error("Expected summary.v2.json $schema to match schemas/summary.v2.json");
  }
  if (summaryV2.schemaPointers?.v1 !== summary.$schema || summaryV2.schemaPointers?.v2 !== summaryV2.$schema) {
    throw new Error("Expected summary.v2 schemaPointers to match emitted summary schema URIs");
  }
  if (
    summaryV2.schemaVersions?.v1 !== summary.schemaVersion ||
    summaryV2.schemaVersions?.v2 !== summaryV2.schemaVersion
  ) {
    throw new Error("Expected summary.v2 schemaVersions to align with emitted summary versions");
  }
  if (summaryV2.compatibility?.v1SummaryPath !== "summary.json") {
    throw new Error("Expected summary.v2 compatibility.v1SummaryPath to be summary.json");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertActionSmoke();
  console.log("Action smoke assertions passed.");
}
