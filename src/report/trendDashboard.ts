import type { TrendDeltaSummary } from "../audit/orchestration.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildTrendDashboardHtml(trend: TrendDeltaSummary): string {
  const points = trend.history?.points ?? [];
  const rows = points
    .map((point) => {
      return `<tr>
        <td>${escapeHtml(point.startedAt)}</td>
        <td>${escapeHtml(point.overallStatus)}</td>
        <td>${point.failedPages}</td>
        <td>${point.a11yViolations}</td>
        <td>${point.performanceBudgetFailures}</td>
        <td>${point.visualFailures}</td>
        <td>${point.durationMs}</td>
      </tr>`;
    })
    .join("\n");

  const insightRows = trend.insights.length
    ? trend.insights
        .map(
          (insight) =>
            `<li><strong>${escapeHtml(insight.title)}</strong> (${escapeHtml(
              insight.severity
            )}) - ${escapeHtml(insight.recommendation)}</li>`
        )
        .join("\n")
    : "<li>No trend insights generated.</li>";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WQG Trend Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; background: #f6f8fc; color: #1f2937; }
    .card { background: #fff; border: 1px solid #d1d9e6; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d9e6; padding: 8px; text-align: left; font-size: 14px; }
    th { background: #eef3fb; }
  </style>
</head>
<body>
  <h1>Trend Dashboard</h1>
  <div class="card">
    <h2>Status</h2>
    <p><strong>Trend status:</strong> ${escapeHtml(trend.status)}</p>
    <p><strong>History directory:</strong> ${escapeHtml(trend.historyDir ?? "n/a")}</p>
    <p><strong>Window:</strong> ${trend.history?.window ?? 0} snapshots</p>
  </div>
  <div class="card">
    <h2>Actionable Insights</h2>
    <ul>
      ${insightRows}
    </ul>
  </div>
  <div class="card">
    <h2>History</h2>
    <table>
      <thead>
        <tr>
          <th>Started At</th>
          <th>Overall</th>
          <th>Failed Pages</th>
          <th>A11y Violations</th>
          <th>Perf Budget Failures</th>
          <th>Visual Failures</th>
          <th>Duration (ms)</th>
        </tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan=\"7\">No trend points available.</td></tr>"}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
