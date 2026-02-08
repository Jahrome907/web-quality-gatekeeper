import type { Summary, SummaryV2 } from "./summary.js";
import { renderReportTemplate } from "./templates/reportTemplate.js";

export function buildHtmlReport(summary: Summary | SummaryV2): string {
  return renderReportTemplate(summary);
}
