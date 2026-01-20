import type { Summary } from "../summary.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return `${Math.round(value)} ms`;
}

function formatRatio(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return value.toFixed(4);
}

function statusPill(status: string): string {
  const normalized = status.toLowerCase();
  return `<span class="pill ${normalized}">${escapeHtml(status)}</span>`;
}

export function renderReportTemplate(summary: Summary): string {
  const a11y = summary.a11y;
  const perf = summary.performance;
  const visual = summary.visual;

  const a11yRows = a11y
    ? `
      <tr><th>Total violations</th><td>${a11y.violations}</td></tr>
      <tr><th>Critical</th><td>${a11y.countsByImpact.critical}</td></tr>
      <tr><th>Serious</th><td>${a11y.countsByImpact.serious}</td></tr>
      <tr><th>Moderate</th><td>${a11y.countsByImpact.moderate}</td></tr>
      <tr><th>Minor</th><td>${a11y.countsByImpact.minor}</td></tr>
    `
    : `<tr><td colspan="2">Skipped</td></tr>`;

  const perfRows = perf
    ? `
      <tr><th>Performance score</th><td>${perf.metrics.performanceScore}</td></tr>
      <tr><th>LCP</th><td>${formatMs(perf.metrics.lcpMs)}</td></tr>
      <tr><th>CLS</th><td>${perf.metrics.cls.toFixed(3)}</td></tr>
      <tr><th>TBT</th><td>${formatMs(perf.metrics.tbtMs)}</td></tr>
      <tr><th>Budget pass</th><td>${
        Object.values(perf.budgetResults).every(Boolean) ? "pass" : "fail"
      }</td></tr>
    `
    : `<tr><td colspan="2">Skipped</td></tr>`;

  const visualRows = visual
    ? visual.results
        .map((result) => {
          const diffLink = result.diffPath
            ? `<a href="${escapeHtml(result.diffPath)}">diff</a>`
            : "n/a";
          return `
            <tr>
              <th>${escapeHtml(result.name)}</th>
              <td>${result.status}</td>
              <td>${formatRatio(result.mismatchRatio)}</td>
              <td><a href="${escapeHtml(result.currentPath)}">current</a></td>
              <td><a href="${escapeHtml(result.baselinePath)}">baseline</a></td>
              <td>${diffLink}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="6">Skipped</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Quality Gatekeeper Report</title>
  <style>
    :root {
      --bg: #f6f7fb;
      --card: #ffffff;
      --text: #1f2933;
      --muted: #667085;
      --accent: #2f80ed;
      --pass: #1b873f;
      --fail: #b42318;
      --skipped: #9b8c00;
      --border: #e4e7ec;
    }

    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background: linear-gradient(120deg, #f6f7fb 0%, #eef3ff 60%, #fef6ee 100%);
      color: var(--text);
    }

    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }

    .header {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 24px;
    }

    .header h1 {
      margin: 0;
      font-size: 28px;
    }

    .meta {
      color: var(--muted);
      font-size: 14px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      box-shadow: 0 6px 16px rgba(31, 41, 51, 0.06);
    }

    .card h3 {
      margin: 0 0 8px;
      font-size: 16px;
      color: var(--muted);
    }

    .card strong {
      font-size: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      text-align: left;
      padding: 8px 6px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }

    th {
      color: var(--muted);
      font-weight: 600;
    }

    .pill {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .pill.pass {
      background: #d1fae5;
      color: var(--pass);
    }

    .pill.fail {
      background: #fee4e2;
      color: var(--fail);
    }

    .pill.skipped {
      background: #fef7c3;
      color: var(--skipped);
    }

    .section {
      margin-bottom: 24px;
    }

    .section h2 {
      font-size: 20px;
      margin-bottom: 12px;
    }

    @media (max-width: 720px) {
      .container {
        padding: 24px 16px 40px;
      }

      table {
        font-size: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Web Quality Gatekeeper</h1>
      <div class="meta">${escapeHtml(summary.url)}</div>
      <div class="meta">Started ${escapeHtml(summary.startedAt)} · Duration ${summary.durationMs} ms</div>
    </div>

    <div class="grid">
      <div class="card">
        <h3>Overall</h3>
        <strong>${statusPill(summary.overallStatus)}</strong>
      </div>
      <div class="card">
        <h3>Accessibility</h3>
        <strong>${statusPill(summary.steps.a11y)}</strong>
      </div>
      <div class="card">
        <h3>Performance</h3>
        <strong>${statusPill(summary.steps.perf)}</strong>
      </div>
      <div class="card">
        <h3>Visual</h3>
        <strong>${statusPill(summary.steps.visual)}</strong>
      </div>
    </div>

    <div class="section card">
      <h2>Accessibility</h2>
      <table>
        <tbody>
          ${a11yRows}
        </tbody>
      </table>
    </div>

    <div class="section card">
      <h2>Performance</h2>
      <table>
        <tbody>
          ${perfRows}
        </tbody>
      </table>
    </div>

    <div class="section card">
      <h2>Visual Diff</h2>
      <table>
        <thead>
          <tr>
            <th>View</th>
            <th>Status</th>
            <th>Mismatch</th>
            <th>Current</th>
            <th>Baseline</th>
            <th>Diff</th>
          </tr>
        </thead>
        <tbody>
          ${visualRows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
