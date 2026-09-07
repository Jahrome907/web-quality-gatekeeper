import path from "node:path";
import { createReportViewModel, type HtmlReportSource } from "./viewModel.js";
import { renderReportTemplate } from "./templates/reportTemplate.js";

export type { AggregateHtmlReport, HtmlReportSource, ReportViewModel } from "./viewModel.js";

export interface HtmlReportOptions {
  reportPath?: string;
}

function isExternalOrFragmentPath(value: string): boolean {
  return value.startsWith("#") || value.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function createAssetPathRebaser(reportPath: string | undefined) {
  if (!reportPath) {
    return undefined;
  }
  const normalizedReportPath = reportPath.replaceAll("\\", "/");
  if (path.posix.isAbsolute(normalizedReportPath)) {
    throw new Error("HTML report path must be relative to the output bundle.");
  }
  const reportDirectory = path.posix.dirname(normalizedReportPath);
  if (reportDirectory === ".") {
    return undefined;
  }

  return (assetPath: string): string => {
    if (isExternalOrFragmentPath(assetPath)) {
      return assetPath;
    }
    const normalizedAssetPath = assetPath.replaceAll("\\", "/");
    return (
      path.posix.relative(reportDirectory, normalizedAssetPath) ||
      path.posix.basename(normalizedAssetPath)
    );
  };
}

export function buildHtmlReport(
  summary: HtmlReportSource,
  options: HtmlReportOptions = {}
): string {
  return renderReportTemplate(
    createReportViewModel(summary),
    createAssetPathRebaser(options.reportPath)
  );
}
