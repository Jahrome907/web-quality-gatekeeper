import { createReportViewModel, type HtmlReportSource } from "./viewModel.js";
import { renderReportTemplate } from "./templates/reportTemplate.js";

export type { AggregateHtmlReport, HtmlReportSource, ReportViewModel } from "./viewModel.js";

export function buildHtmlReport(summary: HtmlReportSource): string {
  return renderReportTemplate(createReportViewModel(summary));
}
