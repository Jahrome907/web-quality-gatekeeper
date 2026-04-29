import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSummary,
  buildSummaryV2,
  SCHEMA_VERSION,
  SCHEMA_VERSION_V2,
  SUMMARY_ARTIFACT_NAMES,
  SUMMARY_SCHEMA_POINTERS,
  SUMMARY_SCHEMA_URI,
  SUMMARY_SCHEMA_URI_V2,
  SUMMARY_SCHEMA_VERSIONS,
  SUMMARY_V2_COMPATIBILITY_NOTE
} from "../src/report/summary.js";
import {
  cleanupTempDirs,
  createBaseConfig,
  createRunDirs,
  createRuntimeSignals,
  createSummaryV2Validator,
  mockLoadConfig,
  resetPhase4Mocks
} from "./helpers/phase4Harness.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const summaryV1Schema = JSON.parse(
  readFileSync(path.join(process.cwd(), "schemas", "summary.v1.json"), "utf8")
) as {
  $id: string;
  properties: { $schema: { const: string }; schemaVersion: { pattern: string } };
};

const summaryV2Schema = JSON.parse(
  readFileSync(path.join(process.cwd(), "schemas", "summary.v2.json"), "utf8")
) as {
  $id: string;
  properties: { $schema: { const: string }; schemaVersion: { const: string } };
  $defs: { detailsSummaryV2: object };
};

const summaryV1Doc = readFileSync(
  path.join(process.cwd(), "docs", "contracts", "summary-v1-contract.md"),
  "utf8"
);
const summaryV2Doc = readFileSync(
  path.join(process.cwd(), "docs", "contracts", "summary-v2-contract.md"),
  "utf8"
);
const compatibilityBaselineDoc = readFileSync(
  path.join(process.cwd(), "docs", "contracts", "compatibility-baseline.md"),
  "utf8"
);
const qualityGateWorkflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "quality-gate.yml"),
  "utf8"
);

const v1BaseParams = {
  url: "https://example.com",
  startedAt: "2026-03-12T00:00:00.000Z",
  durationMs: 1234,
  toolVersion: "3.1.4",
  screenshots: [{ name: "home", path: "screenshots/home.png", url: "https://example.com", fullPage: true }],
  artifacts: {
    summary: SUMMARY_ARTIFACT_NAMES.summary,
    report: SUMMARY_ARTIFACT_NAMES.report,
    axe: null,
    lighthouse: null,
    screenshotsDir: "screenshots",
    diffsDir: "diffs",
    baselineDir: "../baselines"
  },
  options: {
    failOnA11y: true,
    failOnPerf: true,
    failOnVisual: true
  }
};

const v2BaseParams = {
  url: "https://example.com",
  startedAt: "2026-03-12T00:00:00.000Z",
  durationMs: 1234,
  toolVersion: "3.1.4",
  screenshots: [{ name: "home", path: "screenshots/home.png", url: "https://example.com", fullPage: true }],
  artifacts: {
    summary: SUMMARY_ARTIFACT_NAMES.summary,
    summaryV2: SUMMARY_ARTIFACT_NAMES.summaryV2,
    report: SUMMARY_ARTIFACT_NAMES.report,
    axe: null,
    lighthouse: null,
    screenshotsDir: "screenshots",
    diffsDir: "diffs",
    baselineDir: "../baselines"
  },
  runtimeSignals: createRuntimeSignals(),
  options: {
    failOnA11y: true,
    failOnPerf: true,
    failOnVisual: true
  }
};

function createValidator(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

function createSummaryV2DetailsValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(summaryV2Schema);
  const validate = ajv.getSchema(`${summaryV2Schema.$id}#/$defs/detailsSummaryV2`);
  if (!validate) {
    throw new Error("Failed to resolve summary.v2 details schema");
  }
  return validate;
}

describe("summary contract drift gate", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    resetPhase4Mocks();
  });

  afterEach(async () => {
    await cleanupTempDirs(tempDirs);
  });

  it("keeps runtime schema constants aligned with schema files and emitted summary payloads", () => {
    const validateSummaryV1 = createValidator(summaryV1Schema);
    const validateSummaryV2Details = createSummaryV2DetailsValidator();

    expect(SUMMARY_SCHEMA_URI).toBe(summaryV1Schema.$id);
    expect(SUMMARY_SCHEMA_URI).toBe(summaryV1Schema.properties.$schema.const);
    expect(SCHEMA_VERSION).toMatch(new RegExp(summaryV1Schema.properties.schemaVersion.pattern));
    expect(SUMMARY_SCHEMA_URI_V2).toBe(summaryV2Schema.$id);
    expect(SUMMARY_SCHEMA_URI_V2).toBe(summaryV2Schema.properties.$schema.const);
    expect(SCHEMA_VERSION_V2).toBe(summaryV2Schema.properties.schemaVersion.const);
    expect(SUMMARY_SCHEMA_POINTERS).toEqual({
      v1: SUMMARY_SCHEMA_URI,
      v2: SUMMARY_SCHEMA_URI_V2
    });
    expect(SUMMARY_SCHEMA_VERSIONS).toEqual({
      v1: SCHEMA_VERSION,
      v2: SCHEMA_VERSION_V2
    });

    const summary = buildSummary({
      ...v1BaseParams,
      a11y: null,
      performance: null,
      visual: null
    });
    const summaryV2Details = buildSummaryV2({
      ...v2BaseParams,
      a11y: null,
      performance: null,
      visual: null
    });

    expect(validateSummaryV1(summary), JSON.stringify(validateSummaryV1.errors, null, 2)).toBe(true);
    expect(validateSummaryV2Details(summaryV2Details), JSON.stringify(validateSummaryV2Details.errors, null, 2)).toBe(true);
  });

  it("keeps aggregate summary pointers and versions aligned with the shared runtime constants", async () => {
    const { outDir, baselineDir } = await createRunDirs(tempDirs);

    mockLoadConfig.mockResolvedValue(createBaseConfig());

    const { runAudit } = await import("../src/index.js");
    const result = await runAudit("https://example.com", {
      config: "ignored.json",
      out: outDir,
      baselineDir,
      setBaseline: false,
      failOnA11y: true,
      failOnPerf: true,
      failOnVisual: true,
      verbose: false,
      auth: null
    });

    const validateSummaryV2 = createSummaryV2Validator();
    expect(validateSummaryV2(result.summaryV2), JSON.stringify(validateSummaryV2.errors, null, 2)).toBe(
      true
    );

    expect(result.summaryV2.schemaPointers).toEqual(SUMMARY_SCHEMA_POINTERS);
    expect(result.summaryV2.schemaVersions).toEqual(SUMMARY_SCHEMA_VERSIONS);
    expect(result.summaryV2.compatibility).toEqual({
      v1SummaryPath: SUMMARY_ARTIFACT_NAMES.summary,
      v1Schema: SUMMARY_SCHEMA_POINTERS.v1,
      v1SchemaVersion: SUMMARY_SCHEMA_VERSIONS.v1,
      note: SUMMARY_V2_COMPATIBILITY_NOTE
    });
  });

  it("keeps contract docs aligned with the current schema pointers, versions, and verification command", () => {
    expect(summaryV1Doc).toContain(`Current schema version: \`${SCHEMA_VERSION}\``);
    expect(summaryV1Doc).toContain(`Schema URI: \`${SUMMARY_SCHEMA_POINTERS.v1}\``);
    expect(summaryV1Doc).toContain("`npm run contracts:check`");
    expect(summaryV2Doc).toContain(`Current schema version: \`${SCHEMA_VERSION_V2}\``);
    expect(summaryV2Doc).toContain(`Schema URI: \`${SUMMARY_SCHEMA_POINTERS.v2}\``);
    expect(summaryV2Doc).toContain("`npm run contracts:check`");
    expect(compatibilityBaselineDoc).toContain(`Schema URI: \`${SUMMARY_SCHEMA_POINTERS.v1}\``);
    expect(compatibilityBaselineDoc).toContain(`Schema version: \`${SUMMARY_SCHEMA_VERSIONS.v1}\``);
    expect(compatibilityBaselineDoc).toContain(`Schema URI: \`${SUMMARY_SCHEMA_POINTERS.v2}\``);
    expect(compatibilityBaselineDoc).toContain(`Schema version: \`${SUMMARY_SCHEMA_VERSIONS.v2}\``);
    expect(compatibilityBaselineDoc).toContain("`npm run contracts:check`");
  });

  it("keeps the quality gate workflow wired to the explicit contract drift command", () => {
    expect(qualityGateWorkflow).toContain("- name: Check summary contracts");
    expect(qualityGateWorkflow).toContain("run: npm run contracts:check");
  });

  it("keeps stable artifact names and the compatibility note centralized", () => {
    expect(SUMMARY_ARTIFACT_NAMES).toEqual({
      summary: "summary.json",
      summaryV2: "summary.v2.json",
      report: "report.html",
      actionPlan: "action-plan.md"
    });
    expect(SUMMARY_V2_COMPATIBILITY_NOTE).toBe(
      "summary.json remains v1-compatible. summary.v2.json contains multipage and trend fields."
    );
  });
});
