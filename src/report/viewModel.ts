import type { AuditSummaryV2, TrendInsight } from "../audit/orchestration.js";
import type { RuntimeSignalSummary } from "../runner/playwright.js";
import type { InsightsSummary, Summary, SummaryV2 } from "./summary.js";

export interface AggregateHtmlReport {
  kind: "aggregate";
  summary: AuditSummaryV2;
  steps: Summary["steps"];
}

export type HtmlReportSource = Summary | SummaryV2 | AggregateHtmlReport;

export interface ReportViewModel {
  kind: "single" | "aggregate";
  displayTarget: string;
  startedAt: string;
  durationMs: number;
  overallStatus: Summary["overallStatus"];
  steps: Summary["steps"];
  summary: Summary | SummaryV2;
  insights: InsightsSummary | null;
  trendInsights: TrendInsight[];
  aggregate:
    | {
        pageCount: number;
        failedPages: number;
        primaryPageName: string | null;
        primaryPageUrl: string;
        pages: AuditSummaryV2["pages"];
      }
    | null;
}

function isAggregateHtmlReport(source: HtmlReportSource): source is AggregateHtmlReport {
  return "kind" in source && source.kind === "aggregate";
}

function createEmptyRuntimeSignals(): RuntimeSignalSummary {
  return {
    console: {
      total: 0,
      errorCount: 0,
      warningCount: 0,
      dropped: 0,
      messages: []
    },
    jsErrors: {
      total: 0,
      dropped: 0,
      errors: []
    },
    network: {
      totalRequests: 0,
      failedRequests: 0,
      transferSizeBytes: 0,
      resourceTypeBreakdown: {}
    }
  };
}

function normalizeDetailSummary(summary: Summary | SummaryV2): Summary | SummaryV2 {
  return {
    ...summary,
    screenshots: summary.screenshots ?? []
  };
}

function createFallbackSummary(source: AggregateHtmlReport): SummaryV2 {
  return {
    $schema: source.summary.schemaPointers.v2,
    schemaVersion: source.summary.schemaVersions.v2,
    toolVersion: source.summary.toolVersion,
    overallStatus: source.summary.overallStatus,
    url: source.summary.primaryUrl,
    startedAt: source.summary.startedAt,
    durationMs: source.summary.durationMs,
    steps: source.steps,
    artifacts: {
      summary: source.summary.artifacts.summary,
      summaryV2: source.summary.artifacts.summaryV2,
      report: source.summary.artifacts.report,
      axe: null,
      lighthouse: null,
      screenshotsDir: "",
      diffsDir: "",
      baselineDir: ""
    },
    screenshots: [],
    a11y: null,
    performance: null,
    visual: null,
    runtimeSignals: createEmptyRuntimeSignals(),
    insights: source.summary.insights ?? null
  };
}

export function createReportViewModel(source: HtmlReportSource): ReportViewModel {
  if (isAggregateHtmlReport(source)) {
    const primaryPage = source.summary.pages[0];
    const detailSummary = normalizeDetailSummary(primaryPage?.details ?? createFallbackSummary(source));
    const pageCount = source.summary.rollup.pageCount;

    const aggregate =
      pageCount > 1
        ? {
            pageCount,
            failedPages: source.summary.rollup.failedPages,
            primaryPageName: primaryPage?.name ?? null,
            primaryPageUrl: primaryPage?.url ?? source.summary.primaryUrl,
            pages: source.summary.pages
          }
        : null;

    return {
      kind: pageCount > 1 ? "aggregate" : "single",
      displayTarget:
        pageCount > 1
          ? `Aggregate report for ${pageCount} pages`
          : primaryPage?.url ?? source.summary.primaryUrl,
      startedAt: source.summary.startedAt,
      durationMs: source.summary.durationMs,
      overallStatus: source.summary.overallStatus,
      steps: source.steps,
      summary: detailSummary,
      insights: source.summary.insights ?? null,
      trendInsights: source.summary.trend.insights,
      aggregate
    };
  }

  return {
    kind: "single",
    displayTarget: source.url,
    startedAt: source.startedAt,
    durationMs: source.durationMs,
    overallStatus: source.overallStatus,
    steps: source.steps,
    summary: normalizeDetailSummary(source),
    insights: "insights" in source ? source.insights ?? null : null,
    trendInsights: [],
    aggregate: null
  };
}
