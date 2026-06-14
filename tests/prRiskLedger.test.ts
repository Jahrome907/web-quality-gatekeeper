import path from "node:path";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  PR_RISK_LEDGER_SCHEMA_URI,
  PR_RISK_LEDGER_SCHEMA_VERSION,
  buildPrRiskLedger,
  formatPrRiskLedgerAsMarkdown
} from "../src/report/prRiskLedger.js";
import type { AuditSummaryV2 } from "../src/audit/orchestration.js";

const require = createRequire(import.meta.url);
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const ledgerSchema = JSON.parse(
  readFileSync(path.join(process.cwd(), "schemas", "pr-risk-ledger.v1.json"), "utf8")
) as {
  $id: string;
  properties: { $schema: { const: string }; schemaVersion: { const: string } };
};

function createValidator(schema: object) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema);
}

const a11yRecommendation = {
  id: "a11y-button-name",
  source: "a11y" as const,
  severity: "high" as const,
  title: "Button lacks an accessible name",
  why: "Screen reader users need a label.",
  evidence: ["button-name violation on home"],
  remediation: ["Add an accessible label."],
  verification: ["Rerun axe and confirm the violation clears."],
  expectedImpact: "Improves checkout accessibility.",
  references: []
};

function createSummary(): AuditSummaryV2 {
  return {
    $schema: "https://example.com/summary.v2.json",
    schemaVersion: "2.3.0",
    toolVersion: "3.1.5",
    mode: "multi",
    overallStatus: "fail",
    startedAt: "2026-05-11T20:00:00.000Z",
    durationMs: 1200,
    primaryUrl: "https://example.com/",
    schemaPointers: {
      v1: "v1",
      v2: "v2"
    },
    schemaVersions: {
      v1: "1.1.0",
      v2: "2.3.0"
    },
    compatibility: {
      v1SummaryPath: "summary.json",
      v1Schema: "v1",
      v1SchemaVersion: "1.1.0",
      note: "summary.json remains v1-compatible"
    },
    artifacts: {
      summary: "summary.json",
      summaryV2: "summary.v2.json",
      report: "report.html",
      prRiskLedgerJson: "pr-risk-ledger.json",
      prRiskLedgerMd: "pr-risk-ledger.md",
      trendDashboardHtml: null,
      trendHistoryJson: null,
      actionPlanMd: "action-plan.md"
    },
    rollup: {
      pageCount: 2,
      failedPages: 1,
      a11yViolations: 2,
      performanceBudgetFailures: 1,
      visualFailures: 0
    },
    pages: [
      {
        index: 0,
        name: "home",
        url: "https://example.com/",
        overallStatus: "fail",
        startedAt: "2026-05-11T20:00:00.000Z",
        durationMs: 800,
        steps: {
          playwright: "pass",
          a11y: "fail",
          perf: "fail",
          visual: "pass"
        },
        artifacts: {
          summary: "pages/main/summary.json",
          summaryV2: "pages/main/summary.v2.json",
          report: "pages/main/report.html"
        },
        metrics: {
          a11yViolations: 2,
          performanceScore: 0.62,
          maxMismatchRatio: 0,
          consoleErrors: 1,
          jsErrors: 0,
          failedRequests: 0
        },
        details: {
          insights: {
            recommendations: [a11yRecommendation]
          }
        } as never
      },
      {
        index: 1,
        name: "pricing",
        url: "https://example.com/pricing",
        overallStatus: "pass",
        startedAt: "2026-05-11T20:00:01.000Z",
        durationMs: 400,
        steps: {
          playwright: "pass",
          a11y: "pass",
          perf: "pass",
          visual: "pass"
        },
        artifacts: {
          summary: "pages/pricing/summary.json",
          summaryV2: "pages/pricing/summary.v2.json",
          report: "pages/pricing/report.html"
        },
        metrics: {
          a11yViolations: 0,
          performanceScore: 0.94,
          maxMismatchRatio: 0,
          consoleErrors: 0,
          jsErrors: 0,
          failedRequests: 0
        },
        details: {
          insights: null
        } as never
      }
    ],
    trend: {
      status: "ready",
      historyDir: "trends",
      previousSnapshotPath: "trends/previous.json",
      message: "Compared with previous snapshot.",
      metrics: null,
      pages: [
        {
          name: "home",
          url: "https://example.com/",
          statusChanged: false,
          a11yViolations: { current: 2, previous: 2, delta: 0 },
          performanceScore: { current: 0.62, previous: 0.62, delta: 0 },
          maxMismatchRatio: { current: 0, previous: 0, delta: 0 }
        },
        {
          name: "pricing",
          url: "https://example.com/pricing",
          statusChanged: false,
          a11yViolations: { current: 0, previous: 0, delta: 0 },
          performanceScore: { current: 0.94, previous: 0.99, delta: -0.05 },
          maxMismatchRatio: { current: 0, previous: 0, delta: 0 }
        }
      ],
      history: null,
      insights: [
        {
          id: "perf-regression",
          severity: "medium",
          title: "Performance regressed",
          recommendation: "Review new render-blocking work."
        }
      ]
    },
    insights: {
      recommendations: [a11yRecommendation]
    }
  };
}

describe("PR Risk Ledger", () => {
  it("builds deterministic merge-risk entries from aggregate summary data", () => {
    const ledger = buildPrRiskLedger(createSummary());

    expect(ledger.$schema).toBe(PR_RISK_LEDGER_SCHEMA_URI);
    expect(ledger.schemaVersion).toBe(PR_RISK_LEDGER_SCHEMA_VERSION);
    expect(ledger.riskCount).toBe(6);
    expect(ledger.highestSeverity).toBe("high");
    expect(ledger.entries.map((entry) => entry.id)).toEqual([
      "a11y:violations",
      "aggregate:failed-pages",
      "insight:a11y-button-name",
      "perf:budget-failures",
      "runtime:signals",
      "trend:perf-regression"
    ]);
    expect(ledger.entries[1]?.affectedSurfaces).toEqual(["home (https://example.com/)"]);
  });

  it("attributes insight and trend entries to the source page when page detail is available", () => {
    const ledger = buildPrRiskLedger(createSummary());
    const entriesById = new Map(ledger.entries.map((entry) => [entry.id, entry]));

    expect(entriesById.get("insight:a11y-button-name")?.affectedSurfaces).toEqual([
      "home (https://example.com/)"
    ]);
    expect(entriesById.get("trend:perf-regression")?.affectedSurfaces).toEqual([
      "pricing (https://example.com/pricing)"
    ]);
  });

  it("formats markdown from the ledger object", () => {
    const ledger = buildPrRiskLedger(createSummary());
    const markdown = formatPrRiskLedgerAsMarkdown(ledger);

    expect(markdown).toContain("# PR Risk Ledger");
    expect(markdown).toContain("- Overall status: **FAIL**");
    expect(markdown).toContain("## HIGH - 1 audited page failed the gate");
    expect(markdown).toContain("- Report: `report.html`");
    expect(markdown).toContain("button-name violation on home");
  });

  it("keeps the ledger schema aligned with emitted ledger payloads", () => {
    const ledger = buildPrRiskLedger(createSummary());
    const validate = createValidator(ledgerSchema);

    expect(PR_RISK_LEDGER_SCHEMA_URI).toBe(ledgerSchema.$id);
    expect(PR_RISK_LEDGER_SCHEMA_URI).toBe(ledgerSchema.properties.$schema.const);
    expect(PR_RISK_LEDGER_SCHEMA_VERSION).toBe(ledgerSchema.properties.schemaVersion.const);
    expect(validate(ledger), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("accepts package versions with prerelease and build metadata", () => {
    const ledger = buildPrRiskLedger({
      ...createSummary(),
      toolVersion: "3.1.6-beta.1+build.5"
    });
    const validate = createValidator(ledgerSchema);

    expect(validate(ledger), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it("keeps the ledger schema pointer on the stable v3 contract ref", () => {
    expect(PR_RISK_LEDGER_SCHEMA_URI).toContain("/web-quality-gatekeeper/v3/schemas/");
    expect(ledgerSchema.$id).toContain("/web-quality-gatekeeper/v3/schemas/");
    expect(PR_RISK_LEDGER_SCHEMA_URI).not.toContain("/web-quality-gatekeeper/main/schemas/");
  });

  it("escapes untrusted markdown fields before writing the PR ledger", () => {
    const ledger = buildPrRiskLedger({
      ...createSummary(),
      primaryUrl: "https://example.com/?q=<script>",
      artifacts: {
        ...createSummary().artifacts,
        report: "reports/`unsafe`.html",
        summaryV2: "summary.v2.json"
      },
      pages: [
        {
          ...createSummary().pages[0]!,
          name: "home | <script>alert(1)</script>",
          url: "https://example.com/?q=<script>"
        }
      ],
      insights: {
        recommendations: [
          {
            id: "unsafe-markdown",
            source: "runtime",
            severity: "high",
            title: "Unsafe [link](https://bad.example)",
            why: "Unsafe text",
            evidence: ["Evidence with <script> and `ticks`"],
            remediation: ["Do not trust [markdown](https://bad.example)."],
            verification: ["Confirm <script> is escaped."],
            expectedImpact: "Safer markdown.",
            references: []
          }
        ]
      },
      trend: {
        ...createSummary().trend,
        insights: []
      }
    });
    const markdown = formatPrRiskLedgerAsMarkdown(ledger);

    expect(markdown).toContain("home \\| &lt;script&gt;alert\\(1\\)&lt;/script&gt;");
    expect(markdown).toContain("Unsafe \\[link\\]\\(https://bad.example\\)");
    expect(markdown).toContain("Evidence with &lt;script&gt; and \\`ticks\\`");
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("[link](https://bad.example)");
  });
});
