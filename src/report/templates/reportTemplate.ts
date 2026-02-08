import type { Summary } from "../summary.js";

type ScoreTone = "good" | "warn" | "bad" | "muted";
type VitalState = "pass" | "needs-improvement" | "fail" | "unknown";

interface DiagnosticEntry {
  message: string;
  source: string | null;
  location: string | null;
}

interface DiagnosticBucket {
  count: number;
  entries: DiagnosticEntry[];
  truncated: boolean;
  available: boolean;
}

interface DiagnosticsData {
  consoleErrors: DiagnosticBucket;
  jsErrors: DiagnosticBucket;
  available: boolean;
}

interface ResourceSlice {
  type: "JS" | "CSS" | "Image" | "Font" | "Other";
  bytes: number;
  requests: number;
}

interface ResourceBreakdownData {
  slices: ResourceSlice[];
  totalBytes: number;
  totalRequests: number;
  truncated: boolean;
  available: boolean;
}

interface VitalDefinition {
  id: string;
  label: string;
  unit: "ms" | "ratio";
  good: number;
  needsImprovement: number;
}

const MAX_DIAGNOSTIC_ROWS = 25;
const GAUGE_RADIUS = 44;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

const VITAL_DEFINITIONS: VitalDefinition[] = [
  { id: "fcp", label: "FCP", unit: "ms", good: 1800, needsImprovement: 3000 },
  { id: "lcp", label: "LCP", unit: "ms", good: 2500, needsImprovement: 4000 },
  { id: "cls", label: "CLS", unit: "ratio", good: 0.1, needsImprovement: 0.25 },
  { id: "tbt", label: "TBT", unit: "ms", good: 200, needsImprovement: 600 },
  { id: "ttfb", label: "TTFB", unit: "ms", good: 800, needsImprovement: 1800 }
];

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return `${Math.round(value)} ms`;
}

export function formatRatio(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "n/a";
  }
  return value.toFixed(4);
}

function toNonNegativeNumber(value: number): number {
  return value < 0 ? 0 : value;
}

function toNonNegativeInteger(value: number): number {
  return Math.max(0, Math.round(value));
}

function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(value);
}

function formatBytes(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }

  if (value < 1024) {
    return `${formatNumber(value, 0)} B`;
  }
  if (value < 1024 * 1024) {
    return `${formatNumber(value / 1024, 1)} KB`;
  }
  return `${formatNumber(value / (1024 * 1024), 2)} MB`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function pickField(record: Record<string, unknown> | null, keys: string[]): unknown {
  if (!record) {
    return undefined;
  }
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function scoreTone(score: number | null | undefined): ScoreTone {
  if (typeof score !== "number") {
    return "muted";
  }
  if (score >= 0.9) {
    return "good";
  }
  if (score >= 0.5) {
    return "warn";
  }
  return "bad";
}

function statusPill(status: string): string {
  const normalized = status.toLowerCase();
  return `<span class="pill ${normalized}">${escapeHtml(status)}</span>`;
}

function toneBadge(label: string, tone: ScoreTone): string {
  return `<span class="tone-badge ${tone}">${escapeHtml(label)}</span>`;
}

function normalizeAssetPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") {
    return null;
  }
  const trimmed = path.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function renderGauge(label: string, score: number | null | undefined): string {
  if (typeof score !== "number") {
    return `
      <article class="gauge-card card">
        <h3>${escapeHtml(label)}</h3>
        <div class="gauge-shell muted-gauge">
          <span class="gauge-empty">n/a</span>
        </div>
      </article>
    `;
  }

  const percent = clamp(Math.round(score * 100), 0, 100);
  const tone = scoreTone(score);
  const dash = (percent / 100) * GAUGE_CIRCUMFERENCE;
  const gap = GAUGE_CIRCUMFERENCE - dash;

  return `
    <article class="gauge-card card">
      <h3>${escapeHtml(label)}</h3>
      <div class="gauge-shell">
        <svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(
          `${label} score ${percent} out of 100`
        )}">
          <circle class="gauge-track" cx="60" cy="60" r="${GAUGE_RADIUS}" />
          <circle
            class="gauge-progress ${tone}"
            cx="60"
            cy="60"
            r="${GAUGE_RADIUS}"
            stroke-dasharray="${dash} ${gap}"
          />
        </svg>
        <div class="gauge-value">
          <strong>${percent}</strong>
          <span>/100</span>
        </div>
      </div>
      ${toneBadge(tone === "good" ? "Good" : tone === "warn" ? "Needs improvement" : "Poor", tone)}
    </article>
  `;
}

function vitalState(value: number | null, def: VitalDefinition): VitalState {
  if (value === null) {
    return "unknown";
  }
  if (value <= def.good) {
    return "pass";
  }
  if (value <= def.needsImprovement) {
    return "needs-improvement";
  }
  return "fail";
}

function formatVitalValue(value: number | null, def: VitalDefinition): string {
  if (value === null) {
    return "n/a";
  }
  if (def.unit === "ratio") {
    return value.toFixed(3);
  }
  return `${Math.round(value)} ms`;
}

function thresholdPosition(value: number | null, def: VitalDefinition): number {
  if (value === null) {
    return 0;
  }
  const max = def.needsImprovement * 1.4;
  if (max === 0) {
    return 0;
  }
  return clamp((value / max) * 100, 0, 100);
}

function renderVitalCard(label: string, value: number | null, def: VitalDefinition): string {
  const state = vitalState(value, def);
  const markerLeft = thresholdPosition(value, def);
  const stateLabel =
    state === "pass" ? "Pass" : state === "needs-improvement" ? "Needs improvement" : state === "fail" ? "Fail" : "Unknown";

  return `
    <article class="vital-card card">
      <header>
        <h3>${escapeHtml(label)}</h3>
        <span class="vital-value">${escapeHtml(formatVitalValue(value, def))}</span>
      </header>
      <div class="vital-bar" role="img" aria-label="${escapeHtml(
        `${label} is ${stateLabel}. Pass threshold: ${def.good}, needs improvement threshold: ${def.needsImprovement}.`
      )}">
        <span class="vital-segment pass"></span>
        <span class="vital-segment warn"></span>
        <span class="vital-segment fail"></span>
        ${
          value === null
            ? ""
            : `<span class="vital-marker ${state}" style="left:${markerLeft.toFixed(1)}%"></span>`
        }
      </div>
      <div class="vital-legend">
        <span>Pass <= ${escapeHtml(formatVitalValue(def.good, def))}</span>
        <span>Needs <= ${escapeHtml(formatVitalValue(def.needsImprovement, def))}</span>
      </div>
      <div class="vital-state ${state}">${escapeHtml(stateLabel)}</div>
    </article>
  `;
}

function normalizeDiagnosticEntry(value: unknown): DiagnosticEntry | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return {
      message: value.trim(),
      source: null,
      location: null
    };
  }

  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const message = toStringValue(record.message) ?? toStringValue(record.text) ?? "";

  if (message.trim().length === 0) {
    return null;
  }

  const source = toStringValue(record.type) ?? toStringValue(record.source);
  const locationDirect = toStringValue(record.location);
  const url = toStringValue(record.url) ?? toStringValue(record.file);
  const line = toFiniteNumber(record.line) ?? toFiniteNumber(record.lineNumber);
  const column = toFiniteNumber(record.column) ?? toFiniteNumber(record.columnNumber);

  let location: string | null = locationDirect;
  if (!location && url) {
    location = url;
    if (line !== null) {
      location += `:${Math.round(line)}`;
      if (column !== null) {
        location += `:${Math.round(column)}`;
      }
    }
  }

  return {
    message: message.trim(),
    source,
    location
  };
}

function extractDiagnosticBucket(source: unknown): DiagnosticBucket {
  if (source === undefined || source === null) {
    return { count: 0, entries: [], truncated: false, available: false };
  }

  const sourceRecord = toRecord(source);
  const list = Array.isArray(source)
    ? source
    : Array.isArray(sourceRecord?.entries)
      ? sourceRecord.entries
      : [];

  const entries = list
    .map((item) => normalizeDiagnosticEntry(item))
    .filter((item): item is DiagnosticEntry => item !== null)
    .slice(0, MAX_DIAGNOSTIC_ROWS);

  const rawCountValue =
    toFiniteNumber(sourceRecord?.count) ??
    (Array.isArray(source) ? source.length : list.length);
  const rawCount = toNonNegativeInteger(rawCountValue);
  const inferredTruncated = toBoolean(sourceRecord?.truncated) ?? rawCount > entries.length;

  return {
    count: rawCount,
    entries,
    truncated: inferredTruncated,
    available: true
  };
}

function extractDiagnostics(summary: Summary): DiagnosticsData {
  const root = summary as unknown as Record<string, unknown>;
  const runtimeSignals = toRecord(root.runtimeSignals);
  if (runtimeSignals) {
    const consoleSignals = toRecord(runtimeSignals.console);
    const jsSignals = toRecord(runtimeSignals.jsErrors);

    const consoleEntries = Array.isArray(consoleSignals?.messages) ? consoleSignals.messages : [];
    const jsEntries = Array.isArray(jsSignals?.errors) ? jsSignals.errors : [];

    const consoleErrors = extractDiagnosticBucket({
      count: toNonNegativeInteger(
        toFiniteNumber(consoleSignals?.errorCount) ??
          toFiniteNumber(consoleSignals?.total) ??
          consoleEntries.length
      ),
      truncated: toNonNegativeInteger(toFiniteNumber(consoleSignals?.dropped) ?? 0) > 0,
      entries: consoleEntries
    });
    const jsErrors = extractDiagnosticBucket({
      count: toNonNegativeInteger(
        toFiniteNumber(jsSignals?.total) ?? jsEntries.length
      ),
      truncated: toNonNegativeInteger(toFiniteNumber(jsSignals?.dropped) ?? 0) > 0,
      entries: jsEntries
    });

    return {
      consoleErrors,
      jsErrors,
      available: true
    };
  }

  const perf = summary.performance;
  const perfRecord = perf ? (perf as unknown as Record<string, unknown>) : null;
  const diagnosticsRecord = toRecord(pickField(perfRecord, ["diagnostics"]));

  const consoleLegacy = toRecord(diagnosticsRecord?.consoleErrors);
  const jsLegacy = toRecord(diagnosticsRecord?.jsErrors);

  const consoleSource = consoleLegacy
    ? {
        count:
          toFiniteNumber(consoleLegacy.total) ??
          toFiniteNumber(consoleLegacy.count) ??
          (Array.isArray(consoleLegacy.entries) ? consoleLegacy.entries.length : 0),
        truncated: toBoolean(consoleLegacy.truncated) ?? false,
        entries: Array.isArray(consoleLegacy.entries) ? consoleLegacy.entries : []
      }
    : undefined;
  const jsSource = jsLegacy
    ? {
        count:
          toFiniteNumber(jsLegacy.total) ??
          toFiniteNumber(jsLegacy.count) ??
          (Array.isArray(jsLegacy.entries) ? jsLegacy.entries.length : 0),
        truncated: toBoolean(jsLegacy.truncated) ?? false,
        entries: Array.isArray(jsLegacy.entries) ? jsLegacy.entries : []
      }
    : undefined;

  const consoleErrors = extractDiagnosticBucket(consoleSource);
  const jsErrors = extractDiagnosticBucket(jsSource);

  return {
    consoleErrors,
    jsErrors,
    available: consoleErrors.available || jsErrors.available
  };
}

function normalizeResourceType(raw: string): ResourceSlice["type"] {
  const normalized = raw.toLowerCase();
  if (normalized.includes("script") || normalized === "js" || normalized.includes("javascript")) {
    return "JS";
  }
  if (normalized.includes("style") || normalized === "css") {
    return "CSS";
  }
  if (normalized.includes("image") || normalized.includes("img")) {
    return "Image";
  }
  if (normalized.includes("font")) {
    return "Font";
  }
  return "Other";
}

function extractResourceBreakdown(summary: Summary): ResourceBreakdownData {
  const root = summary as unknown as Record<string, unknown>;
  const runtimeSignals = toRecord(root.runtimeSignals);
  const runtimeNetwork = toRecord(runtimeSignals?.network);
  if (runtimeNetwork) {
    const rawBreakdown = toRecord(runtimeNetwork.resourceTypeBreakdown);
    const breakdownEntries = rawBreakdown ? Object.entries(rawBreakdown) : [];
    const byType = new Map<ResourceSlice["type"], { requests: number }>([
      ["JS", { requests: 0 }],
      ["CSS", { requests: 0 }],
      ["Image", { requests: 0 }],
      ["Font", { requests: 0 }],
      ["Other", { requests: 0 }]
    ]);

    for (const [typeName, countLike] of breakdownEntries) {
      const normalizedType = normalizeResourceType(typeName);
      const count = toNonNegativeInteger(toFiniteNumber(countLike) ?? 0);
      const bucket = byType.get(normalizedType);
      if (bucket) {
        bucket.requests += count;
      }
    }

    const breakdownRequestTotal = Array.from(byType.values()).reduce(
      (total, bucket) => total + bucket.requests,
      0
    );
    const totalRequests = toNonNegativeInteger(
      toFiniteNumber(runtimeNetwork.totalRequests) ?? breakdownRequestTotal
    );
    const transferSizeBytes = toNonNegativeNumber(
      toFiniteNumber(runtimeNetwork.transferSizeBytes) ?? 0
    );
    const requestDenominator = breakdownRequestTotal > 0 ? breakdownRequestTotal : totalRequests;

    const slices: ResourceSlice[] = Array.from(byType.entries()).map(([type, bucket]) => {
      const inferredBytes =
        requestDenominator > 0
          ? (transferSizeBytes * bucket.requests) / requestDenominator
          : 0;
      return {
        type,
        bytes: toNonNegativeNumber(inferredBytes),
        requests: toNonNegativeInteger(bucket.requests)
      };
    });

    return {
      slices,
      totalBytes: transferSizeBytes,
      totalRequests,
      truncated: false,
      available: true
    };
  }

  const perf = summary.performance;
  const perfRecord = perf ? (perf as unknown as Record<string, unknown>) : null;
  const diagnosticsRecord = toRecord(pickField(perfRecord, ["diagnostics"]));
  const legacyResource = toRecord(diagnosticsRecord?.resourceBreakdown);

  if (!legacyResource) {
    return { slices: [], totalBytes: 0, totalRequests: 0, truncated: false, available: false };
  }

  const items = Array.isArray(legacyResource.items)
    ? legacyResource.items
        .map((item) => toRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
    : [];
  const byType = new Map<ResourceSlice["type"], { bytes: number; requests: number }>([
    ["JS", { bytes: 0, requests: 0 }],
    ["CSS", { bytes: 0, requests: 0 }],
    ["Image", { bytes: 0, requests: 0 }],
    ["Font", { bytes: 0, requests: 0 }],
    ["Other", { bytes: 0, requests: 0 }]
  ]);

  for (const item of items) {
    const typeRaw = toStringValue(item.type) ?? toStringValue(item.resourceType) ?? "other";
    const normalizedType = normalizeResourceType(typeRaw);
    const bytes = toNonNegativeNumber(
      toFiniteNumber(item.transferSize) ??
        toFiniteNumber(item.bytes) ??
        0
    );
    const requests = toNonNegativeInteger(
      toFiniteNumber(item.requestCount) ??
        toFiniteNumber(item.count) ??
        0
    );

    const bucket = byType.get(normalizedType);
    if (bucket) {
      bucket.bytes += bytes;
      bucket.requests += requests;
    }
  }

  const slices: ResourceSlice[] = Array.from(byType.entries()).map(([type, totals]) => ({
    type,
    bytes: toNonNegativeNumber(totals.bytes),
    requests: toNonNegativeInteger(totals.requests)
  }));

  const computedBytes = toNonNegativeNumber(slices.reduce((total, slice) => total + slice.bytes, 0));
  const computedRequests = toNonNegativeInteger(
    slices.reduce((total, slice) => total + slice.requests, 0)
  );
  const declaredBytes = toNonNegativeNumber(toFiniteNumber(legacyResource.totalBytes) ?? computedBytes);
  const declaredRequests = toNonNegativeInteger(
    toFiniteNumber(legacyResource.totalRequests) ?? computedRequests
  );
  const truncated = toBoolean(legacyResource.truncated) ?? false;

  return {
    slices,
    totalBytes: declaredBytes,
    totalRequests: declaredRequests,
    truncated,
    available: true
  };
}

export function renderReportTemplate(summary: Summary): string {
  const a11y = summary.a11y;
  const perf = summary.performance;
  const visual = summary.visual;
  const diagnostics = extractDiagnostics(summary);
  const resources = extractResourceBreakdown(summary);

  // Executive summary.
  const a11yRows = a11y
    ? `
      <tr><th>Total violations</th><td>${a11y.violations}</td></tr>
      <tr><th>Critical</th><td>${a11y.countsByImpact.critical}</td></tr>
      <tr><th>Serious</th><td>${a11y.countsByImpact.serious}</td></tr>
      <tr><th>Moderate</th><td>${a11y.countsByImpact.moderate}</td></tr>
      <tr><th>Minor</th><td>${a11y.countsByImpact.minor}</td></tr>
    `
    : `<tr><td colspan="2">Skipped</td></tr>`;

  // Gauges.
  const categoryScores = perf?.categoryScores;
  const gaugeMarkup = [
    renderGauge("Performance", categoryScores?.performance),
    renderGauge("Accessibility", categoryScores?.accessibility),
    renderGauge("Best Practices", categoryScores?.bestPractices),
    renderGauge("SEO", categoryScores?.seo)
  ].join("");

  const vitalValues = {
    fcp: toFiniteNumber(perf?.extendedMetrics?.fcpMs ?? null),
    lcp: toFiniteNumber(perf?.metrics?.lcpMs ?? null),
    cls: toFiniteNumber(perf?.metrics?.cls ?? null),
    tbt: toFiniteNumber(perf?.metrics?.tbtMs ?? null),
    ttfb: toFiniteNumber(perf?.extendedMetrics?.ttfbMs ?? null)
  };

  const vitalsMarkup = VITAL_DEFINITIONS.map((def) =>
    renderVitalCard(def.label, vitalValues[def.id as keyof typeof vitalValues], def)
  ).join("");

  // Opportunities.
  const opportunityRows =
    perf?.opportunities && perf.opportunities.length > 0
      ? [...perf.opportunities]
          .sort((left, right) => {
            const leftScore = (left.estimatedSavingsMs ?? 0) + (left.estimatedSavingsBytes ?? 0) / 1000;
            const rightScore = (right.estimatedSavingsMs ?? 0) + (right.estimatedSavingsBytes ?? 0) / 1000;
            return rightScore - leftScore;
          })
          .map(
            (opportunity) => `
              <tr>
                <td>
                  <div class="opportunity-title">${escapeHtml(opportunity.title)}</div>
                  <div class="opportunity-id">${escapeHtml(opportunity.id)}</div>
                </td>
                <td>${formatNumber(opportunity.score * 100, 0)}</td>
                <td>${escapeHtml(
                  opportunity.estimatedSavingsMs !== null
                    ? `${Math.round(opportunity.estimatedSavingsMs)} ms`
                    : "n/a"
                )}</td>
                <td>${escapeHtml(formatBytes(opportunity.estimatedSavingsBytes))}</td>
                <td>${escapeHtml(opportunity.displayValue || "n/a")}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="5">No opportunities captured.</td></tr>`;

  // A11y details.
  const a11yDetails = a11y?.details ?? [];
  const a11yViolationsMarkup =
    a11yDetails.length > 0
      ? a11yDetails
          .map((violation) => {
            const impact = violation.impact ? violation.impact.toLowerCase() : "unknown";
            const wcagTags =
              violation.wcagTags.length > 0
                ? violation.wcagTags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")
                : `<span class="muted">No WCAG tags</span>`;
            const nodeRows =
              violation.nodes.length > 0
                ? violation.nodes
                    .map(
                      (node) => `
                        <li>
                          <div class="node-target">${escapeHtml(node.target.join(" "))}</div>
                          ${
                            node.failureSummary
                              ? `<div class="node-summary">${escapeHtml(node.failureSummary)}</div>`
                              : ""
                          }
                        </li>
                      `
                    )
                    .join("")
                : "<li>No impacted nodes were retained.</li>";

            return `
              <details class="violation-item">
                <summary>
                  <span class="rule-id">${escapeHtml(violation.id)}</span>
                  <span class="impact-badge ${escapeHtml(impact)}">${escapeHtml(impact)}</span>
                  <span class="node-count">${violation.nodes.length} nodes</span>
                </summary>
                <div class="violation-content">
                  <p>${escapeHtml(violation.description || "No description provided.")}</p>
                  <div class="violation-tags">${wcagTags}</div>
                  <p class="violation-help">
                    <strong>Fix guidance:</strong> ${escapeHtml(violation.help || "No guidance provided.")}
                    ${
                      violation.helpUrl
                        ? ` <a href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noreferrer">Reference</a>`
                        : ""
                    }
                  </p>
                  <ul class="node-list">${nodeRows}</ul>
                </div>
              </details>
            `;
          })
          .join("")
      : `<p class="muted">No accessibility violations captured.</p>`;

  // Visual block.
  const visualCards =
    visual && visual.results.length > 0
      ? visual.results
          .map((result) => {
            const mismatch = result.mismatchRatio !== null ? formatRatio(result.mismatchRatio) : "n/a";
            const baselinePath = normalizeAssetPath(result.baselinePath);
            const currentPath = normalizeAssetPath(result.currentPath);
            const diffPath = normalizeAssetPath(result.diffPath);
            return `
              <article class="visual-card card">
                <header>
                  <h3>${escapeHtml(result.name)}</h3>
                  <div class="visual-meta">${statusPill(result.status)}</div>
                </header>
                <div class="visual-grid">
                  <figure>
                    ${
                      baselinePath
                        ? `<img src="${escapeHtml(baselinePath)}" alt="${escapeHtml(
                            `${result.name} baseline screenshot`
                          )}" loading="lazy" />`
                        : `<div class="image-fallback">Baseline unavailable</div>`
                    }
                    <figcaption>Baseline</figcaption>
                  </figure>
                  <figure>
                    ${
                      currentPath
                        ? `<img src="${escapeHtml(currentPath)}" alt="${escapeHtml(
                            `${result.name} current screenshot`
                          )}" loading="lazy" />`
                        : `<div class="image-fallback">Current unavailable</div>`
                    }
                    <figcaption>Current</figcaption>
                  </figure>
                  <figure>
                    ${
                      diffPath
                        ? `<img src="${escapeHtml(diffPath)}" alt="${escapeHtml(
                            `${result.name} visual diff`
                          )}" loading="lazy" />`
                        : `<div class="image-fallback">Diff unavailable</div>`
                    }
                    <figcaption>Diff</figcaption>
                  </figure>
                </div>
                <p class="visual-ratio">Mismatch ratio: <strong>${escapeHtml(mismatch)}</strong></p>
              </article>
            `;
          })
          .join("")
      : `<p class="muted">Visual diff step skipped or no results captured.</p>`;

  // Runtime diagnostics.
  const consoleRows =
    diagnostics.consoleErrors.entries.length > 0
      ? diagnostics.consoleErrors.entries
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.message)}</td>
                <td>${escapeHtml(entry.source ?? "n/a")}</td>
                <td>${escapeHtml(entry.location ?? "n/a")}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="3">No console error details available.</td></tr>`;

  const jsRows =
    diagnostics.jsErrors.entries.length > 0
      ? diagnostics.jsErrors.entries
          .map(
            (entry) => `
              <tr>
                <td>${escapeHtml(entry.message)}</td>
                <td>${escapeHtml(entry.source ?? "n/a")}</td>
                <td>${escapeHtml(entry.location ?? "n/a")}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="3">No JavaScript runtime error details available.</td></tr>`;

  // Resource chart.
  const resourceTotal = resources.totalBytes > 0 ? resources.totalBytes : 0;
  const resourceBar = resources.available
    ? resources.slices
        .map((slice) => {
          const percent = resourceTotal > 0 ? clamp((slice.bytes / resourceTotal) * 100, 0, 100) : 0;
          return `<span class="resource-segment ${slice.type.toLowerCase()}" style="width:${percent.toFixed(
            1
          )}%"></span>`;
        })
        .join("")
    : "";

  const resourceRows = resources.available
    ? resources.slices
        .map(
          (slice) => `
            <tr>
              <th>${slice.type}</th>
              <td>${escapeHtml(formatBytes(slice.bytes))}</td>
              <td>${formatNumber(slice.requests, 0)}</td>
              <td>${resourceTotal > 0 ? formatNumber((slice.bytes / resourceTotal) * 100, 1) : "0.0"}%</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="4">Resource breakdown not available in summary data.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Web Quality Gatekeeper Report</title>
  <style>
    /* Theme/print/responsive CSS */
    :root {
      color-scheme: light;
      --bg: #eef2f8;
      --bg-strong: #dce6f5;
      --card: #ffffff;
      --text: #1c2533;
      --muted: #5f6c7e;
      --border: #d7dee9;
      --accent: #0d6efd;
      --good: #127a3a;
      --warn: #9d5800;
      --bad: #b42318;
      --shadow: 0 10px 26px rgba(26, 35, 49, 0.09);
      --chart-js: #0b6e99;
      --chart-css: #6c4ce4;
      --chart-image: #1e9d4d;
      --chart-font: #bf7900;
      --chart-other: #6c7380;
    }

    html[data-theme="dark"] {
      color-scheme: dark;
      --bg: #0f1724;
      --bg-strong: #182238;
      --card: #111b2c;
      --text: #edf2fb;
      --muted: #b6c0cf;
      --border: #2a3850;
      --accent: #5ca7ff;
      --good: #4bd28a;
      --warn: #ffb34d;
      --bad: #ff8278;
      --shadow: 0 14px 30px rgba(4, 7, 12, 0.45);
      --chart-js: #62c1ea;
      --chart-css: #ab96ff;
      --chart-image: #64d98c;
      --chart-font: #ffce7d;
      --chart-other: #c2c8d2;
    }

    body {
      margin: 0;
      font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 10% 10%, var(--bg-strong), transparent 40%),
        radial-gradient(circle at 90% 0%, rgba(13, 110, 253, 0.12), transparent 32%),
        var(--bg);
      color: var(--text);
    }

    .container {
      max-width: 1240px;
      margin: 0 auto;
      padding: 28px 22px 48px;
    }

    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      margin-bottom: 20px;
    }

    .header h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: -0.02em;
    }

    .meta {
      color: var(--muted);
      font-size: 14px;
    }

    .theme-toggle {
      align-self: start;
      border: 1px solid var(--border);
      background: var(--card);
      color: var(--text);
      border-radius: 999px;
      padding: 8px 14px;
      cursor: pointer;
      font: inherit;
    }

    /* Executive summary */
    .summary-card {
      margin-bottom: 18px;
    }

    .summary-card p {
      margin: 0;
      color: var(--muted);
      line-height: 1.5;
    }

    .summary-points {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      margin-top: 14px;
    }

    .summary-point {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px;
      background: color-mix(in srgb, var(--card) 90%, var(--accent) 10%);
      font-size: 14px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      box-shadow: var(--shadow);
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
      vertical-align: top;
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
      background: color-mix(in srgb, var(--good) 16%, transparent);
      color: var(--good);
    }

    .pill.fail {
      background: color-mix(in srgb, var(--bad) 20%, transparent);
      color: var(--bad);
    }

    .pill.skipped {
      background: color-mix(in srgb, var(--warn) 22%, transparent);
      color: var(--warn);
    }

    .tone-badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 700;
      width: fit-content;
    }

    .tone-badge.good {
      background: color-mix(in srgb, var(--good) 14%, transparent);
      color: var(--good);
    }

    .tone-badge.warn {
      background: color-mix(in srgb, var(--warn) 18%, transparent);
      color: var(--warn);
    }

    .tone-badge.bad {
      background: color-mix(in srgb, var(--bad) 18%, transparent);
      color: var(--bad);
    }

    .tone-badge.muted {
      background: color-mix(in srgb, var(--muted) 16%, transparent);
      color: var(--muted);
    }

    .section {
      margin-bottom: 24px;
    }

    .section h2 {
      font-size: 20px;
      margin-bottom: 12px;
    }

    /* Gauges */
    .gauge-card {
      display: grid;
      gap: 10px;
      justify-items: center;
      text-align: center;
    }

    .gauge-shell {
      position: relative;
      width: 120px;
      height: 120px;
      display: grid;
      place-items: center;
    }

    .gauge-track {
      fill: none;
      stroke: color-mix(in srgb, var(--muted) 22%, transparent);
      stroke-width: 10;
    }

    .gauge-progress {
      fill: none;
      stroke-width: 10;
      transform: rotate(-90deg);
      transform-origin: 60px 60px;
      stroke-linecap: round;
    }

    .gauge-progress.good {
      stroke: var(--good);
    }

    .gauge-progress.warn {
      stroke: var(--warn);
    }

    .gauge-progress.bad {
      stroke: var(--bad);
    }

    .gauge-value {
      position: absolute;
      display: flex;
      flex-direction: column;
      line-height: 1;
    }

    .gauge-value strong {
      font-size: 30px;
    }

    .gauge-value span {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
    }

    .muted-gauge {
      border-radius: 50%;
      border: 10px solid color-mix(in srgb, var(--muted) 22%, transparent);
    }

    .gauge-empty {
      color: var(--muted);
      font-size: 20px;
      font-weight: 700;
    }

    .vital-card header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 8px;
    }

    .vital-value {
      font-weight: 700;
      font-size: 16px;
    }

    .vital-bar {
      position: relative;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 2px;
      height: 14px;
      border-radius: 999px;
      overflow: hidden;
      margin-bottom: 8px;
      border: 1px solid var(--border);
    }

    .vital-segment.pass {
      background: color-mix(in srgb, var(--good) 40%, transparent);
    }

    .vital-segment.warn {
      background: color-mix(in srgb, var(--warn) 45%, transparent);
    }

    .vital-segment.fail {
      background: color-mix(in srgb, var(--bad) 45%, transparent);
    }

    .vital-marker {
      position: absolute;
      top: -3px;
      margin-left: -4px;
      width: 8px;
      height: 20px;
      border-radius: 3px;
      border: 1px solid var(--card);
    }

    .vital-marker.pass {
      background: var(--good);
    }

    .vital-marker.needs-improvement {
      background: var(--warn);
    }

    .vital-marker.fail {
      background: var(--bad);
    }

    .vital-legend {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: var(--muted);
      margin-bottom: 8px;
    }

    .vital-state {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .vital-state.pass {
      color: var(--good);
    }

    .vital-state.needs-improvement {
      color: var(--warn);
    }

    .vital-state.fail {
      color: var(--bad);
    }

    .vital-state.unknown {
      color: var(--muted);
    }

    /* Opportunities */
    .opportunity-title {
      font-weight: 600;
      margin-bottom: 3px;
    }

    .opportunity-id {
      color: var(--muted);
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
    }

    /* A11y details */
    .violation-item {
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 10px;
      overflow: clip;
      background: color-mix(in srgb, var(--card) 92%, var(--bg-strong) 8%);
    }

    .violation-item summary {
      list-style: none;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      padding: 12px 14px;
      font-size: 14px;
      font-weight: 600;
    }

    .violation-item summary::-webkit-details-marker {
      display: none;
    }

    .rule-id {
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      background: color-mix(in srgb, var(--bg-strong) 75%, transparent);
      border-radius: 6px;
      padding: 4px 8px;
    }

    .impact-badge {
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.03em;
    }

    .impact-badge.critical,
    .impact-badge.serious {
      background: color-mix(in srgb, var(--bad) 20%, transparent);
      color: var(--bad);
    }

    .impact-badge.moderate,
    .impact-badge.minor {
      background: color-mix(in srgb, var(--warn) 20%, transparent);
      color: var(--warn);
    }

    .impact-badge.unknown {
      background: color-mix(in srgb, var(--muted) 20%, transparent);
      color: var(--muted);
    }

    .node-count {
      margin-left: auto;
      color: var(--muted);
      font-size: 12px;
    }

    .violation-content {
      border-top: 1px solid var(--border);
      padding: 12px 14px 14px;
    }

    .violation-content p {
      margin: 0 0 10px;
      line-height: 1.5;
    }

    .violation-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }

    .tag {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      color: var(--muted);
    }

    .node-list {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 8px;
    }

    .node-target {
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 2px;
    }

    .node-summary {
      font-size: 13px;
      line-height: 1.4;
    }

    /* Visual block */
    .visual-card header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .visual-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .visual-grid figure {
      margin: 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: color-mix(in srgb, var(--card) 90%, var(--bg-strong) 10%);
    }

    .visual-grid img,
    .image-fallback {
      display: block;
      width: 100%;
      height: 180px;
      object-fit: cover;
      background: color-mix(in srgb, var(--bg-strong) 70%, transparent);
    }

    .image-fallback {
      display: grid;
      place-items: center;
      color: var(--muted);
      font-size: 13px;
    }

    .visual-grid figcaption {
      padding: 8px 10px;
      font-size: 12px;
      color: var(--muted);
      border-top: 1px solid var(--border);
    }

    .visual-ratio {
      margin: 10px 0 0;
      font-size: 14px;
    }

    /* Runtime diagnostics */
    .diagnostic-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .diagnostic-card h3 {
      margin-bottom: 6px;
    }

    .diagnostic-count {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }

    .diagnostic-note {
      color: var(--muted);
      margin: 0 0 8px;
      font-size: 13px;
    }

    /* Resource chart */
    .resource-stack {
      display: flex;
      height: 18px;
      border-radius: 999px;
      overflow: hidden;
      border: 1px solid var(--border);
      margin-bottom: 12px;
      background: color-mix(in srgb, var(--muted) 10%, transparent);
    }

    .resource-segment.js {
      background: var(--chart-js);
    }

    .resource-segment.css {
      background: var(--chart-css);
    }

    .resource-segment.image {
      background: var(--chart-image);
    }

    .resource-segment.font {
      background: var(--chart-font);
    }

    .resource-segment.other {
      background: var(--chart-other);
    }

    .muted {
      color: var(--muted);
    }

    a {
      color: var(--accent);
    }

    @media (max-width: 940px) {
      .header {
        grid-template-columns: 1fr;
      }

      .theme-toggle {
        justify-self: start;
      }

      .visual-grid {
        grid-template-columns: 1fr;
      }

      .diagnostic-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 720px) {
      .container {
        padding: 24px 16px 40px;
      }

      .header h1 {
        font-size: 26px;
      }

      table {
        font-size: 12px;
      }
    }

    @media print {
      body {
        background: #fff;
        color: #000;
      }

      .container {
        max-width: none;
        padding: 0;
      }

      .card {
        box-shadow: none;
        break-inside: avoid;
      }

      .theme-toggle {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>Web Quality Gatekeeper</h1>
        <div class="meta">${escapeHtml(summary.url)}</div>
        <div class="meta">Started ${escapeHtml(summary.startedAt)} · Duration ${summary.durationMs} ms</div>
      </div>
      <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false">Toggle dark mode</button>
    </div>

    <section class="section card summary-card">
      <h2>Executive Summary</h2>
      <p>
        Overall status is <strong>${escapeHtml(summary.overallStatus.toUpperCase())}</strong>.
        This report combines automated accessibility, Lighthouse performance diagnostics,
        and deterministic visual diff checks for a single review surface.
      </p>
      <div class="summary-points">
        <div class="summary-point">Accessibility step: ${statusPill(summary.steps.a11y)}</div>
        <div class="summary-point">Performance step: ${statusPill(summary.steps.perf)}</div>
        <div class="summary-point">Visual step: ${statusPill(summary.steps.visual)}</div>
        <div class="summary-point">Captured screenshots: ${summary.screenshots.length}</div>
      </div>
    </section>

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

    <section class="section">
      <h2>Category Scores</h2>
      <div class="grid">
        ${gaugeMarkup}
      </div>
    </section>

    <section class="section">
      <h2>Core Web Vitals</h2>
      <div class="grid">
        ${vitalsMarkup}
      </div>
    </section>

    <div class="section card">
      <h2>Accessibility</h2>
      <table>
        <tbody>
          ${a11yRows}
        </tbody>
      </table>
    </div>

    <div class="section card">
      <h2>Accessibility Violations</h2>
      ${
        a11y?.metadata
          ? `<p class="muted">
              Captured ${a11y.metadata.keptViolations} of ${a11y.metadata.totalViolations} violations.
              ${
                a11y.metadata.droppedViolations > 0
                  ? `Dropped ${a11y.metadata.droppedViolations} violations due to truncation limits.`
                  : ""
              }
              ${
                a11y.metadata.droppedNodes > 0
                  ? `Dropped ${a11y.metadata.droppedNodes} impacted nodes due to truncation limits.`
                  : ""
              }
            </p>`
          : `<p class="muted">Detailed accessibility metadata unavailable.</p>`
      }
      ${a11yViolationsMarkup}
    </div>

    <div class="section card">
      <h2>Lighthouse Opportunities</h2>
      <table>
        <thead>
          <tr>
            <th>Opportunity</th>
            <th>Score</th>
            <th>Savings (ms)</th>
            <th>Savings (bytes)</th>
            <th>Display value</th>
          </tr>
        </thead>
        <tbody>
          ${opportunityRows}
        </tbody>
      </table>
    </div>

    <section class="section">
      <h2>Baseline, Current, and Diff Screenshots</h2>
      ${visualCards}
    </section>

    <section class="section card">
      <h2>Console and JavaScript Errors</h2>
      ${
        diagnostics.available
          ? `<p class="muted">Counts and entries are rendered from summary diagnostics fields when present.</p>`
          : `<p class="muted">No console or runtime error diagnostics were provided in summary data.</p>`
      }
      <div class="diagnostic-grid">
        <article class="diagnostic-card">
          <h3>Console Errors</h3>
          <div class="diagnostic-count">${diagnostics.consoleErrors.count}</div>
          ${
            diagnostics.consoleErrors.truncated
              ? `<p class="diagnostic-note">Showing ${diagnostics.consoleErrors.entries.length} of ${diagnostics.consoleErrors.count} entries.</p>`
              : `<p class="diagnostic-note">Showing ${diagnostics.consoleErrors.entries.length} entries.</p>`
          }
          <table>
            <thead>
              <tr><th>Message</th><th>Source</th><th>Location</th></tr>
            </thead>
            <tbody>${consoleRows}</tbody>
          </table>
        </article>
        <article class="diagnostic-card">
          <h3>JavaScript Runtime Errors</h3>
          <div class="diagnostic-count">${diagnostics.jsErrors.count}</div>
          ${
            diagnostics.jsErrors.truncated
              ? `<p class="diagnostic-note">Showing ${diagnostics.jsErrors.entries.length} of ${diagnostics.jsErrors.count} entries.</p>`
              : `<p class="diagnostic-note">Showing ${diagnostics.jsErrors.entries.length} entries.</p>`
          }
          <table>
            <thead>
              <tr><th>Message</th><th>Source</th><th>Location</th></tr>
            </thead>
            <tbody>${jsRows}</tbody>
          </table>
        </article>
      </div>
    </section>

    <section class="section card">
      <h2>Resource Breakdown</h2>
      ${
        resources.available
          ? `<p class="muted">
              Total transfer size: ${escapeHtml(formatBytes(resources.totalBytes))}
              · Total requests: ${formatNumber(resources.totalRequests, 0)}
              ${resources.truncated ? " · Data is truncated." : ""}
            </p>`
          : `<p class="muted">Resource-level transfer data was not provided in summary data.</p>`
      }
      ${resources.available ? `<div class="resource-stack" role="img" aria-label="Resource transfer size breakdown">${resourceBar}</div>` : ""}
      <table>
        <thead>
          <tr>
            <th>Resource type</th>
            <th>Transfer size</th>
            <th>Requests</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          ${resourceRows}
        </tbody>
      </table>
    </section>
  </div>
  <script>
    (() => {
      const key = "wqg-theme";
      const root = document.documentElement;
      const button = document.getElementById("theme-toggle");
      if (!button) return;

      const applyTheme = (theme) => {
        if (theme === "dark") {
          root.setAttribute("data-theme", "dark");
          button.setAttribute("aria-pressed", "true");
        } else {
          root.removeAttribute("data-theme");
          button.setAttribute("aria-pressed", "false");
        }
      };

      const stored = localStorage.getItem(key);
      const preferredDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initial = stored === "dark" || stored === "light" ? stored : preferredDark ? "dark" : "light";
      applyTheme(initial);

      button.addEventListener("click", () => {
        const isDark = root.getAttribute("data-theme") === "dark";
        const next = isDark ? "light" : "dark";
        applyTheme(next);
        localStorage.setItem(key, next);
      });
    })();
  </script>
</body>
</html>`;
}
