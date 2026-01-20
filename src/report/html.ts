import type { Summary } from "./summary.js";
import { renderReportTemplate } from "./templates/reportTemplate.js";

export function buildHtmlReport(summary: Summary): string {
  return renderReportTemplate(summary);
}
