import type { Summary, SummaryV2 } from "../summary.js";

type ScoreTone = "good" | "warn" | "bad" | "muted";
type VitalState = "pass" | "needs-improvement" | "fail" | "unknown";
type GaugeKey = "performance" | "accessibility" | "best-practices" | "seo";

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
const GALLERY_VISIBLE_COUNT = 8;
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

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }
  return null;
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

function renderZoomableImage(imagePath: string, alt: string): string {
  const escapedPath = escapeHtml(imagePath);
  const escapedAlt = escapeHtml(alt);
  return `
    <button
      type="button"
      class="zoom-trigger"
      data-preview-src="${escapedPath}"
      data-preview-alt="${escapedAlt}"
      aria-label="${escapeHtml(`Open ${alt} in larger view`)}"
    >
      <img src="${escapedPath}" alt="${escapedAlt}" loading="lazy" />
    </button>
  `;
}

function renderGalleryOverflow(items: string[], noun: string, containerClass: string): string {
  if (items.length <= GALLERY_VISIBLE_COUNT) {
    return "";
  }
  const remaining = items.slice(GALLERY_VISIBLE_COUNT).join("");
  return `
    <details class="gallery-expander">
      <summary>View all ${items.length} ${escapeHtml(noun)}</summary>
      <div class="${escapeHtml(containerClass)}">
        ${remaining}
      </div>
    </details>
  `;
}

function renderRadarChart(categoryScores: {
  performance?: number;
  accessibility?: number;
  bestPractices?: number;
  seo?: number;
} | undefined): string {
  const axes = [
    { key: "performance" as const, label: "Perf", full: "Performance" },
    { key: "accessibility" as const, label: "A11y", full: "Accessibility" },
    { key: "seo" as const, label: "SEO", full: "SEO" },
    { key: "bestPractices" as const, label: "Best", full: "Best Practices" }
  ];

  const values = axes.map(a => {
    const raw = categoryScores?.[a.key];
    return typeof raw === "number" ? clamp(Math.round(raw * 100), 0, 100) : 0;
  });

  const cx = 140;
  const cy = 140;
  const maxR = 95;
  const levels = 5;
  const n = axes.length;
  const step = (2 * Math.PI) / n;
  const angles = axes.map((_, i) => -Math.PI / 2 + i * step);

  const px = (a: number, r: number) => Number((cx + r * Math.cos(a)).toFixed(1));
  const py = (a: number, r: number) => Number((cy + r * Math.sin(a)).toFixed(1));

  let gridPaths = "";
  for (let lv = 1; lv <= levels; lv++) {
    const r = (maxR * lv) / levels;
    const pts = angles.map(a => `${px(a, r)},${py(a, r)}`).join(" ");
    gridPaths += `<polygon points="${pts}" class="radar-grid" />`;
  }

  let axisLines = "";
  for (const angle of angles) {
    axisLines += `<line x1="${cx}" y1="${cy}" x2="${px(angle, maxR)}" y2="${py(angle, maxR)}" class="radar-axis" />`;
  }

  const dataPts = values.map((v, i) => {
    const r = (maxR * v) / 100;
    return `${px(angles[i]!, r)},${py(angles[i]!, r)}`;
  });
  const dataPolygon = `<polygon points="${dataPts.join(" ")}" class="radar-area" />`;
  const dataOutline = `<polygon points="${dataPts.join(" ")}" class="radar-outline" />`;

  let dots = "";
  values.forEach((v, i) => {
    const r = (maxR * v) / 100;
    const tone = scoreTone(v / 100);
    dots += `<circle cx="${px(angles[i]!, r)}" cy="${py(angles[i]!, r)}" r="4.5" class="radar-dot ${tone}" />`;
  });

  let labels = "";
  const labelOffset = 18;
  axes.forEach((axis, i) => {
    const lx = px(angles[i]!, maxR + labelOffset);
    const ly = py(angles[i]!, maxR + labelOffset);
    const anchor = lx > cx + 5 ? "start" : lx < cx - 5 ? "end" : "middle";
    const baseline = ly < cy - 5 ? "auto" : ly > cy + 5 ? "hanging" : "middle";
    labels += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="${baseline}" class="radar-label">${escapeHtml(axis.label)} <tspan class="radar-score">${values[i]}</tspan></text>`;
  });

  let markers = "";
  for (let lv = 1; lv <= levels; lv++) {
    const pct = Math.round((lv / levels) * 100);
    const r = (maxR * lv) / levels;
    markers += `<text x="${cx + 4}" y="${py(-Math.PI / 2, r) - 4}" class="radar-marker">${pct}</text>`;
  }

  const ariaLabel = axes.map((a, i) => `${a.full}: ${values[i]}`).join(", ");

  return `
    <div class="radar-wrapper">
      <svg viewBox="0 0 280 280" class="radar-chart" role="img"
           aria-label="Category scores radar chart — ${escapeHtml(ariaLabel)}">
        ${gridPaths}
        ${axisLines}
        ${dataPolygon}
        ${dataOutline}
        ${dots}
        ${labels}
        ${markers}
      </svg>
    </div>
  `;
}

function renderGauge(label: string, score: number | null | undefined, key: GaugeKey): string {
  const triggerStart = `<button type="button" class="gauge-trigger" data-gauge-key="${key}" aria-expanded="false" aria-controls="gauge-detail-${key}">`;
  const triggerEnd = `</button>`;
  if (typeof score !== "number") {
    return `
      ${triggerStart}
        <article class="gauge-card card">
          <h3>${escapeHtml(label)}</h3>
          <div class="gauge-shell muted-gauge">
            <span class="gauge-empty">n/a</span>
          </div>
          <p class="gauge-hint">Click for breakdown</p>
        </article>
      ${triggerEnd}
    `;
  }

  const percent = clamp(Math.round(score * 100), 0, 100);
  const tone = scoreTone(score);
  const dash = (percent / 100) * GAUGE_CIRCUMFERENCE;
  const gap = GAUGE_CIRCUMFERENCE - dash;

  return `
    ${triggerStart}
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
        <p class="gauge-hint">Click for breakdown</p>
      </article>
    ${triggerEnd}
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

function extractDiagnostics(summary: Summary | SummaryV2): DiagnosticsData {
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

function extractResourceBreakdown(summary: Summary | SummaryV2): ResourceBreakdownData {
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

export function renderReportTemplate(summary: Summary | SummaryV2): string {
  const a11y = summary.a11y;
  const perf = summary.performance;
  const visual = summary.visual;
  const diagnostics = extractDiagnostics(summary);
  const resources = extractResourceBreakdown(summary);
  const root = summary as unknown as Record<string, unknown>;
  const runtimeSignals = toRecord(root.runtimeSignals);
  const runtimeNetwork = toRecord(runtimeSignals?.network);

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
    renderGauge("Performance", categoryScores?.performance, "performance"),
    renderGauge("Accessibility", categoryScores?.accessibility, "accessibility"),
    renderGauge("Best Practices", categoryScores?.bestPractices, "best-practices"),
    renderGauge("SEO", categoryScores?.seo, "seo")
  ].join("");
  const radarChartMarkup = renderRadarChart(categoryScores);
  const statusChipsMarkup = [
    `<span class="status-chip ${summary.overallStatus}">Overall ${escapeHtml(summary.overallStatus.toUpperCase())}</span>`,
    `<span class="status-chip ${summary.steps.a11y}">A11y ${escapeHtml(summary.steps.a11y.toUpperCase())}</span>`,
    `<span class="status-chip ${summary.steps.perf}">Perf ${escapeHtml(summary.steps.perf.toUpperCase())}</span>`,
    `<span class="status-chip ${summary.steps.visual}">Visual ${escapeHtml(summary.steps.visual.toUpperCase())}</span>`
  ].join("");

  const perfRecord = perf ? (perf as unknown as Record<string, unknown>) : null;
  const perfMetrics = toRecord(perfRecord?.metrics);
  const perfExtended = toRecord(perfRecord?.extendedMetrics);
  const vitalValues = {
    fcp: firstFiniteNumber(
      perfExtended?.fcpMs,
      perfMetrics?.fcpMs,
      perfRecord?.fcpMs
    ),
    lcp: firstFiniteNumber(
      perfMetrics?.lcpMs,
      perfExtended?.lcpMs,
      perfRecord?.lcpMs
    ),
    cls: firstFiniteNumber(
      perfMetrics?.cls,
      perfExtended?.cls,
      perfRecord?.cls
    ),
    tbt: firstFiniteNumber(
      perfMetrics?.tbtMs,
      perfExtended?.tbtMs,
      perfRecord?.tbtMs
    ),
    ttfb: firstFiniteNumber(
      perfExtended?.ttfbMs,
      perfMetrics?.ttfbMs,
      perfRecord?.ttfbMs
    )
  };

  const vitalsMarkup = VITAL_DEFINITIONS.map((def) =>
    renderVitalCard(def.label, vitalValues[def.id as keyof typeof vitalValues], def)
  ).join("");
  const gaugeDetailsMarkup = `
    <article id="gauge-detail-performance" class="gauge-detail card" hidden aria-live="polite">
      <h3>Performance Score Breakdown</h3>
      <ul class="breakdown-list">
        <li>Performance score: <strong>${categoryScores?.performance !== undefined ? `${Math.round(categoryScores.performance * 100)}/100` : "n/a"}</strong></li>
        <li>LCP: <strong>${escapeHtml(formatMs(vitalValues.lcp))}</strong>, CLS: <strong>${escapeHtml(formatRatio(vitalValues.cls))}</strong>, TBT: <strong>${escapeHtml(formatMs(vitalValues.tbt))}</strong></li>
        <li>FCP: <strong>${escapeHtml(formatMs(vitalValues.fcp))}</strong>, TTFB: <strong>${escapeHtml(formatMs(vitalValues.ttfb))}</strong></li>
        <li>Budget checks: <strong>${perf?.budgetResults ? `${perf.budgetResults.performance ? "Perf OK" : "Perf Fail"}, ${perf.budgetResults.lcp ? "LCP OK" : "LCP Fail"}, ${perf.budgetResults.cls ? "CLS OK" : "CLS Fail"}, ${perf.budgetResults.tbt ? "TBT OK" : "TBT Fail"}` : "n/a"}</strong></li>
      </ul>
    </article>
    <article id="gauge-detail-accessibility" class="gauge-detail card" hidden aria-live="polite">
      <h3>Accessibility Score Breakdown</h3>
      <ul class="breakdown-list">
        <li>Accessibility score: <strong>${categoryScores?.accessibility !== undefined ? `${Math.round(categoryScores.accessibility * 100)}/100` : "n/a"}</strong></li>
        <li>Total violations: <strong>${a11y ? `${a11y.violations}` : "n/a"}</strong></li>
        <li>Critical/Serious: <strong>${a11y ? `${a11y.countsByImpact.critical}/${a11y.countsByImpact.serious}` : "n/a"}</strong></li>
        <li>Moderate/Minor: <strong>${a11y ? `${a11y.countsByImpact.moderate}/${a11y.countsByImpact.minor}` : "n/a"}</strong></li>
      </ul>
    </article>
    <article id="gauge-detail-best-practices" class="gauge-detail card" hidden aria-live="polite">
      <h3>Best Practices Score Breakdown</h3>
      <ul class="breakdown-list">
        <li>Best practices score: <strong>${categoryScores?.bestPractices !== undefined ? `${Math.round(categoryScores.bestPractices * 100)}/100` : "n/a"}</strong></li>
        <li>Console errors: <strong>${diagnostics.consoleErrors.count}</strong></li>
        <li>JavaScript runtime errors: <strong>${diagnostics.jsErrors.count}</strong></li>
        <li>Failed network requests: <strong>${runtimeNetwork ? `${toNonNegativeInteger(toFiniteNumber(runtimeNetwork.failedRequests) ?? 0)}` : "n/a"}</strong></li>
      </ul>
    </article>
    <article id="gauge-detail-seo" class="gauge-detail card" hidden aria-live="polite">
      <h3>SEO Score Breakdown</h3>
      <ul class="breakdown-list">
        <li>SEO score: <strong>${categoryScores?.seo !== undefined ? `${Math.round(categoryScores.seo * 100)}/100` : "n/a"}</strong></li>
        <li>Total requests: <strong>${runtimeNetwork ? `${toNonNegativeInteger(toFiniteNumber(runtimeNetwork.totalRequests) ?? 0)}` : "n/a"}</strong></li>
        <li>Transfer size: <strong>${runtimeNetwork ? `${escapeHtml(formatBytes(toFiniteNumber(runtimeNetwork.transferSizeBytes) ?? 0))}` : "n/a"}</strong></li>
        <li>Top opportunity: <strong>${perf?.opportunities?.[0] ? escapeHtml(perf.opportunities[0].title) : "n/a"}</strong></li>
      </ul>
    </article>
  `;

  const screenshotCards = summary.screenshots.map((shot) => {
    const screenshotPath = normalizeAssetPath(shot.path);
    return `
      <article class="capture-card card">
        ${
          screenshotPath
            ? renderZoomableImage(screenshotPath, `${shot.name} Playwright screenshot`)
            : `<div class="image-fallback">Screenshot unavailable</div>`
        }
        <div class="capture-meta">
          <h3>${escapeHtml(shot.name)}</h3>
          <p class="capture-url">${escapeHtml(shot.url)}</p>
          <p class="capture-path">${escapeHtml(shot.path)}</p>
        </div>
      </article>
    `;
  });
  const screenshotCardsVisible =
    screenshotCards.length > 0
      ? screenshotCards.slice(0, GALLERY_VISIBLE_COUNT).join("")
      : `<p class="muted">No Playwright screenshots were captured.</p>`;
  const screenshotCardsOverflow = renderGalleryOverflow(
    screenshotCards,
    "screenshots",
    "capture-gallery"
  );

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
                    : "—"
                )}</td>
                <td>${escapeHtml(
                  opportunity.estimatedSavingsBytes !== null
                    ? formatBytes(opportunity.estimatedSavingsBytes)
                    : "—"
                )}</td>
                <td>${escapeHtml(opportunity.displayValue || "—")}</td>
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
                        ? ` <a href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noopener noreferrer">Reference</a>`
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
      ? visual.results.map((result) => {
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
                      ? renderZoomableImage(baselinePath, `${result.name} baseline screenshot`)
                      : `<div class="image-fallback">Baseline unavailable</div>`
                  }
                  <figcaption>Baseline</figcaption>
                </figure>
                <figure>
                  ${
                    currentPath
                      ? renderZoomableImage(currentPath, `${result.name} current screenshot`)
                      : `<div class="image-fallback">Current unavailable</div>`
                  }
                  <figcaption>Current</figcaption>
                </figure>
                <figure>
                  ${
                    diffPath
                      ? renderZoomableImage(diffPath, `${result.name} visual diff`)
                      : `<div class="image-fallback">Diff unavailable</div>`
                  }
                  <figcaption>Diff</figcaption>
                </figure>
              </div>
              <p class="visual-ratio">Mismatch ratio: <strong>${escapeHtml(mismatch)}</strong></p>
            </article>
          `;
        })
      : [];
  const visualCardsVisible =
    visualCards.length > 0
      ? visualCards.slice(0, GALLERY_VISIBLE_COUNT).join("")
      : `<p class="muted">Visual diff step skipped or no results captured.</p>`;
  const visualCardsOverflow = renderGalleryOverflow(
    visualCards,
    "visual comparisons",
    "visual-list"
  );

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
          const percentLabel = `${formatNumber(percent, 1)}%`;
          const tooltipLabel = `${slice.type}: ${formatBytes(slice.bytes)} · ${formatNumber(
            slice.requests,
            0
          )} requests · ${percentLabel}`;
          return `<span class="resource-segment ${slice.type.toLowerCase()}" style="width:${percent.toFixed(
            1
          )}%"
            tabindex="0"
            aria-label="${escapeHtml(tooltipLabel)}"
          >
            <span class="resource-segment-tooltip">${escapeHtml(tooltipLabel)}</span>
          </span>`;
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
  const resourceLegend =
    resources.available
      ? resources.slices
          .map(
            (slice) => `
              <div class="resource-legend-item">
                <span class="resource-legend-swatch ${slice.type.toLowerCase()}"></span>
                <span>${slice.type}</span>
                <span class="muted">(${escapeHtml(formatBytes(slice.bytes))})</span>
              </div>
            `
          )
          .join("")
      : "";

  return `<!doctype html>
<html lang="en" data-report-view="detailed">
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

    .jump-nav {
      position: sticky;
      top: 10px;
      z-index: 40;
      margin: 0 0 18px;
      border: 1px solid var(--border);
      background: var(--card);
      background: color-mix(in srgb, var(--card) 88%, var(--bg-strong) 12%);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 8px 10px;
    }

    .jump-nav-list {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .jump-nav-link {
      display: inline-block;
      text-decoration: none;
      font-size: 12px;
      font-weight: 700;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 5px 10px;
      background: var(--card);
    }

    .jump-nav-link:hover,
    .jump-nav-link:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.3);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
    }

    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      margin-bottom: 20px;
    }

    .header-actions {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
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

    .view-toggle-group {
      display: inline-flex;
      border: 1px solid var(--border);
      border-radius: 999px;
      overflow: hidden;
      background: var(--card);
    }

    .view-toggle {
      border: 0;
      border-right: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
    }

    .view-toggle:last-child {
      border-right: 0;
    }

    .view-toggle[aria-pressed="true"] {
      background: color-mix(in srgb, var(--accent) 18%, var(--card));
      color: var(--text);
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

    .status-chip-row {
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      font-size: 12px;
      font-weight: 700;
      border-radius: 999px;
      padding: 4px 10px;
      letter-spacing: 0.03em;
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--card) 92%, var(--bg-strong) 8%);
    }

    .status-chip.pass {
      color: var(--good);
      border-color: var(--border);
      border-color: color-mix(in srgb, var(--good) 35%, var(--border));
    }

    .status-chip.fail {
      color: var(--bad);
      border-color: var(--border);
      border-color: color-mix(in srgb, var(--bad) 35%, var(--border));
    }

    .status-chip.skipped {
      color: var(--warn);
      border-color: var(--border);
      border-color: color-mix(in srgb, var(--warn) 35%, var(--border));
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
      transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
    }

    .card:hover,
    .card:focus-within {
      transform: translateY(-1px);
      border-color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
      box-shadow: 0 12px 30px rgba(26, 35, 49, 0.14);
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

    .section:target h2 {
      scroll-margin-top: 70px;
      color: var(--accent);
    }

    [data-report-view="simple"] [data-view-section="detailed"] {
      display: none !important;
    }

    .info-panel {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--card) 90%, var(--bg-strong) 10%);
      padding: 8px 10px;
      margin: 0 0 12px;
    }

    .info-panel summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--muted);
      font-size: 13px;
      list-style: none;
    }

    .info-panel summary::-webkit-details-marker {
      display: none;
    }

    .info-panel p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    /* Gauges */
    .gauge-card {
      display: grid;
      gap: 10px;
      justify-items: center;
      text-align: center;
    }

    .gauge-trigger {
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      width: 100%;
      text-align: inherit;
      cursor: pointer;
    }

    .gauge-trigger:focus-visible .gauge-card {
      outline: 2px solid rgba(13, 110, 253, 0.6);
      outline: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
      outline-offset: 2px;
    }

    .gauge-hint {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    /* Radar chart */
    .scores-layout {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 16px;
      margin-bottom: 16px;
      align-items: start;
    }

    .scores-radar {
      display: grid;
      place-items: center;
    }

    .scores-gauges .grid {
      margin-bottom: 0;
    }

    .radar-wrapper {
      display: grid;
      place-items: center;
      padding: 16px 8px;
    }

    .radar-chart {
      width: 100%;
      max-width: 260px;
      height: auto;
    }

    .radar-grid {
      fill: none;
      stroke: var(--border);
      stroke-width: 0.8;
    }

    .radar-axis {
      stroke: var(--border);
      stroke-width: 0.8;
    }

    .radar-area {
      fill: color-mix(in srgb, var(--accent) 18%, transparent);
      stroke: none;
      transform-origin: 140px 140px;
      animation: radar-fill 0.8s ease-out both;
    }

    @keyframes radar-fill {
      from { opacity: 0; transform: scale(0.3); }
      to   { opacity: 1; transform: scale(1); }
    }

    .radar-outline {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2;
      stroke-linejoin: round;
    }

    .radar-dot {
      stroke: var(--card);
      stroke-width: 2;
    }

    .radar-dot.good  { fill: var(--good); }
    .radar-dot.warn  { fill: var(--warn); }
    .radar-dot.bad   { fill: var(--bad); }
    .radar-dot.muted { fill: var(--muted); }

    .radar-label {
      font-size: 12px;
      font-weight: 700;
      fill: var(--text);
    }

    .radar-score {
      font-size: 11px;
      fill: var(--muted);
      font-weight: 400;
    }

    .radar-marker {
      font-size: 9px;
      fill: var(--muted);
    }

    kbd {
      display: inline-block;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 6px;
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      font-size: 12px;
      background: var(--bg);
      min-width: 22px;
      text-align: center;
    }

    .gauge-details {
      margin-top: 12px;
      display: grid;
      gap: 10px;
    }

    .gauge-detail h3 {
      margin: 0 0 8px;
      color: var(--text);
    }

    .breakdown-list {
      margin: 0;
      padding-left: 18px;
      display: grid;
      gap: 6px;
      font-size: 14px;
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
      transition: stroke-dasharray 1.2s ease-out;
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
      border: 10px solid rgba(95, 108, 126, 0.22);
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

    .capture-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 12px;
    }

    .gallery-expander {
      margin-top: 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--card) 92%, var(--bg-strong) 8%);
      padding: 10px 12px;
    }

    .gallery-expander summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--accent);
      list-style: none;
      -webkit-user-select: none;
      user-select: none;
    }

    .gallery-expander summary::-webkit-details-marker {
      display: none;
    }

    .gallery-expander[open] > summary {
      margin-bottom: 10px;
    }

    .capture-card {
      padding: 0;
      overflow: hidden;
    }

    .zoom-trigger {
      display: block;
      width: 100%;
      border: 0;
      margin: 0;
      padding: 0;
      background: transparent;
      cursor: zoom-in;
    }

    .capture-card img,
    .capture-card .image-fallback {
      width: 100%;
      height: 220px;
      object-fit: cover;
      display: block;
      background: color-mix(in srgb, var(--bg-strong) 70%, transparent);
    }

    .capture-meta {
      padding: 10px 12px 12px;
      border-top: 1px solid var(--border);
    }

    .capture-meta h3 {
      margin: 0 0 6px;
      font-size: 14px;
      color: var(--text);
    }

    .capture-url,
    .capture-path {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      word-break: break-word;
    }

    .capture-path {
      font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
      margin-top: 4px;
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

    .visual-list {
      display: grid;
      gap: 12px;
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

    .resource-segment {
      position: relative;
      min-width: 2px;
      cursor: pointer;
    }

    .resource-segment-tooltip {
      position: absolute;
      left: 50%;
      bottom: calc(100% + 8px);
      transform: translateX(-50%);
      background: color-mix(in srgb, var(--bg) 82%, #000 18%);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 11px;
      line-height: 1.3;
      padding: 6px 8px;
      width: max-content;
      max-width: 240px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
      z-index: 3;
    }

    .resource-segment:hover .resource-segment-tooltip,
    .resource-segment:focus-visible .resource-segment-tooltip {
      opacity: 1;
    }

    .resource-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin: 8px 0 12px;
    }

    .resource-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }

    .resource-legend-swatch {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
    }

    .resource-legend-swatch.js {
      background: var(--chart-js);
    }

    .resource-legend-swatch.css {
      background: var(--chart-css);
    }

    .resource-legend-swatch.image {
      background: var(--chart-image);
    }

    .resource-legend-swatch.font {
      background: var(--chart-font);
    }

    .resource-legend-swatch.other {
      background: var(--chart-other);
    }

    .lightbox {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: grid;
      place-items: center;
    }

    .lightbox[hidden] {
      display: none;
    }

    .lightbox-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(8, 12, 20, 0.75);
    }

    .lightbox-dialog {
      position: relative;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: min(96vw, 1200px);
      max-height: 92vh;
      overflow: auto;
      padding: 10px;
      box-shadow: var(--shadow);
    }

    .lightbox-close {
      position: sticky;
      top: 0;
      margin-left: auto;
      display: block;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 10px;
      background: var(--card);
      color: var(--text);
      cursor: pointer;
      font: inherit;
      z-index: 2;
    }

    .lightbox-image {
      display: block;
      width: 100%;
      height: auto;
      max-height: calc(92vh - 74px);
      object-fit: contain;
      border-radius: 8px;
      background: color-mix(in srgb, var(--bg-strong) 70%, transparent);
    }

    .lightbox-caption {
      margin-top: 8px;
      font-size: 13px;
      color: var(--muted);
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

      .header-actions {
        justify-content: flex-start;
      }

      .visual-grid {
        grid-template-columns: 1fr;
      }

      .diagnostic-grid {
        grid-template-columns: 1fr;
      }

      .jump-nav {
        position: static;
      }

      .scores-layout {
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
    <nav class="jump-nav" aria-label="Report sections">
      <ul class="jump-nav-list">
        <li><a class="jump-nav-link" href="#overview">Overview</a></li>
        <li><a class="jump-nav-link" href="#category-scores">Scores</a></li>
        <li><a class="jump-nav-link" href="#core-web-vitals">Vitals</a></li>
        <li><a class="jump-nav-link" href="#playwright-captures">Screenshots</a></li>
        <li><a class="jump-nav-link" href="#accessibility-summary">A11y</a></li>
        <li><a class="jump-nav-link" href="#accessibility-violations">Violations</a></li>
        <li><a class="jump-nav-link" href="#lighthouse-opportunities">Opportunities</a></li>
        <li><a class="jump-nav-link" href="#visual-comparisons">Visual</a></li>
        <li><a class="jump-nav-link" href="#runtime-errors">Runtime</a></li>
        <li><a class="jump-nav-link" href="#resource-breakdown">Resources</a></li>
      </ul>
    </nav>
    <div class="header">
      <div>
        <h1>Web Quality Gatekeeper</h1>
        <div class="meta">${escapeHtml(summary.url)}</div>
        <div class="meta">Started <time data-iso="${escapeHtml(summary.startedAt)}" datetime="${escapeHtml(summary.startedAt)}">${escapeHtml(summary.startedAt)}</time> · Duration ${formatNumber(summary.durationMs, 0)} ms</div>
      </div>
      <div class="header-actions">
        <div class="view-toggle-group" role="group" aria-label="Report view mode">
          <button class="view-toggle" data-view-mode="simple" type="button" aria-pressed="false">Simple view</button>
          <button class="view-toggle" data-view-mode="detailed" type="button" aria-pressed="true">Detailed view</button>
        </div>
        <button id="copy-summary" class="theme-toggle" type="button" aria-label="Copy report summary to clipboard">Copy summary</button>
        <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false">Toggle dark mode</button>
      </div>
    </div>

    <section id="overview" class="section card summary-card" data-view-section="simple">
      <h2>Executive Summary</h2>
      <p>
        Overall status is <strong>${escapeHtml(summary.overallStatus.toUpperCase())}</strong>.
        This report combines automated accessibility, Lighthouse performance diagnostics,
        and deterministic visual diff checks for a single review surface.
      </p>
      <div class="status-chip-row">
        ${statusChipsMarkup}
      </div>
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

    <section id="category-scores" class="section" data-view-section="simple">
      <h2>Category Scores</h2>
      <details class="info-panel">
        <summary>More info</summary>
        <p>Category scores come from Lighthouse (0-100). Simple view surfaces quick quality posture, detailed view adds diagnostics and opportunities.</p>
      </details>
      <div class="scores-layout">
        <div class="scores-radar card">
          ${radarChartMarkup}
        </div>
        <div class="scores-gauges">
          <div class="grid">
            ${gaugeMarkup}
          </div>
        </div>
      </div>
      <div class="gauge-details">
        ${gaugeDetailsMarkup}
      </div>
    </section>

    <section id="core-web-vitals" class="section" data-view-section="simple">
      <h2>Core Web Vitals</h2>
      <details class="info-panel">
        <summary>More info</summary>
        <p>Thresholds use Web Vitals guidance. If a metric is unavailable from Lighthouse for a run, it renders as n/a without failing report generation.</p>
      </details>
      <div class="grid">
        ${vitalsMarkup}
      </div>
    </section>

    <section id="playwright-captures" class="section" data-view-section="simple">
      <h2>Captured Playwright Screenshots</h2>
      <details class="info-panel">
        <summary>More info</summary>
        <p>This gallery includes deterministic Playwright captures. Enable high-volume mode in config to include many viewport captures per path.</p>
      </details>
      <div class="capture-gallery">
        ${screenshotCardsVisible}
      </div>
      ${screenshotCardsOverflow}
    </section>

    <div id="accessibility-summary" class="section card" data-view-section="detailed">
      <h2>Accessibility</h2>
      <table>
        <tbody>
          ${a11yRows}
        </tbody>
      </table>
    </div>

    <div id="accessibility-violations" class="section card" data-view-section="detailed">
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

    <div id="lighthouse-opportunities" class="section card" data-view-section="detailed">
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

    <section id="visual-comparisons" class="section" data-view-section="detailed">
      <h2>Baseline, Current, and Diff Screenshots</h2>
      <div class="visual-list">
        ${visualCardsVisible}
      </div>
      ${visualCardsOverflow}
    </section>

    <section id="runtime-errors" class="section card" data-view-section="detailed">
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

    <section id="resource-breakdown" class="section card" data-view-section="detailed">
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
      ${
        resources.available
          ? `<div class="resource-legend">${resourceLegend}</div><div class="resource-stack" role="img" aria-label="Resource transfer size breakdown">${resourceBar}</div>`
          : ""
      }
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
  <div id="image-lightbox" class="lightbox" hidden aria-hidden="true">
    <div class="lightbox-backdrop" data-lightbox-close="true"></div>
    <div class="lightbox-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
      <button id="lightbox-close" class="lightbox-close" type="button" data-lightbox-close="true">Close</button>
      <img id="lightbox-image" class="lightbox-image" src="" alt="" />
      <div id="lightbox-caption" class="lightbox-caption"></div>
    </div>
  </div>
  <div id="shortcuts-overlay" class="lightbox" hidden aria-hidden="true">
    <div class="lightbox-backdrop" data-shortcuts-close="true"></div>
    <div class="lightbox-dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button class="lightbox-close" type="button" data-shortcuts-close="true">Close</button>
      <h2 style="margin:0 0 16px;font-size:18px;">Keyboard Shortcuts</h2>
      <table>
        <tbody>
          <tr><th><kbd>?</kbd></th><td>Show this help</td></tr>
          <tr><th><kbd>t</kbd></th><td>Toggle dark / light mode</td></tr>
          <tr><th><kbd>s</kbd></th><td>Switch to simple view</td></tr>
          <tr><th><kbd>d</kbd></th><td>Switch to detailed view</td></tr>
          <tr><th><kbd>c</kbd></th><td>Copy report summary</td></tr>
          <tr><th><kbd>Esc</kbd></th><td>Close overlays</td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <script>
    (() => {
      const themeKey = "wqg-theme";
      const viewKey = "wqg-view";
      const root = document.documentElement;
      const themeButton = document.getElementById("theme-toggle");
      const copyButton = document.getElementById("copy-summary");
      const viewButtons = Array.from(document.querySelectorAll("[data-view-mode]"));
      const gaugeButtons = Array.from(document.querySelectorAll(".gauge-trigger"));
      const gaugePanels = Array.from(document.querySelectorAll(".gauge-detail"));
      const zoomTriggers = Array.from(document.querySelectorAll(".zoom-trigger"));
      const lightbox = document.getElementById("image-lightbox");
      const lightboxImage = document.getElementById("lightbox-image");
      const lightboxCaption = document.getElementById("lightbox-caption");
      const lightboxClose = document.getElementById("lightbox-close");
      const shortcutsOverlay = document.getElementById("shortcuts-overlay");
      let lastFocused = null;
      if (!themeButton) return;

      /* ---- Theme ---- */
      const applyTheme = (theme) => {
        if (theme === "dark") {
          root.setAttribute("data-theme", "dark");
          themeButton.setAttribute("aria-pressed", "true");
        } else {
          root.removeAttribute("data-theme");
          themeButton.setAttribute("aria-pressed", "false");
        }
      };

      /* ---- View toggle ---- */
      const applyView = (view) => {
        const mode = view === "simple" ? "simple" : "detailed";
        root.setAttribute("data-report-view", mode);
        viewButtons.forEach((button) => {
          const pressed = button.getAttribute("data-view-mode") === mode;
          button.setAttribute("aria-pressed", pressed ? "true" : "false");
        });
      };

      const storedTheme = localStorage.getItem(themeKey);
      const preferredDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const initialTheme =
        storedTheme === "dark" || storedTheme === "light"
          ? storedTheme
          : preferredDark
            ? "dark"
            : "light";
      applyTheme(initialTheme);

      const storedView = localStorage.getItem(viewKey);
      const initialView = storedView === "simple" || storedView === "detailed" ? storedView : "detailed";
      applyView(initialView);

      themeButton.addEventListener("click", () => {
        const isDark = root.getAttribute("data-theme") === "dark";
        const next = isDark ? "light" : "dark";
        applyTheme(next);
        localStorage.setItem(themeKey, next);
      });

      viewButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const mode = button.getAttribute("data-view-mode");
          if (!mode) return;
          applyView(mode);
          localStorage.setItem(viewKey, mode);
        });
      });

      /* ---- Gauge detail panels ---- */
      const setGaugePanel = (key) => {
        let activeFound = false;
        gaugePanels.forEach((panel) => {
          if (!(panel instanceof HTMLElement)) return;
          const isTarget = panel.id === "gauge-detail-" + key;
          panel.hidden = !isTarget;
          if (isTarget) {
            activeFound = true;
            panel.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        });

        gaugeButtons.forEach((button) => {
          const isTarget = button.getAttribute("data-gauge-key") === key && activeFound;
          button.setAttribute("aria-expanded", isTarget ? "true" : "false");
        });
      };

      gaugeButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const key = button.getAttribute("data-gauge-key");
          if (!key) return;
          const isExpanded = button.getAttribute("aria-expanded") === "true";
          if (isExpanded) {
            gaugePanels.forEach((panel) => {
              if (panel instanceof HTMLElement) {
                panel.hidden = true;
              }
            });
            button.setAttribute("aria-expanded", "false");
            return;
          }
          setGaugePanel(key);
        });
      });

      /* ---- Image lightbox ---- */
      const closeLightbox = () => {
        if (!lightbox || !lightboxImage || !lightboxCaption) return;
        lightbox.setAttribute("hidden", "true");
        lightbox.setAttribute("aria-hidden", "true");
        lightboxImage.setAttribute("src", "");
        lightboxImage.setAttribute("alt", "");
        lightboxCaption.textContent = "";
        if (lastFocused && typeof lastFocused.focus === "function") {
          lastFocused.focus();
        }
      };

      const openLightbox = (src, alt) => {
        if (!lightbox || !lightboxImage || !lightboxCaption) return;
        lastFocused = document.activeElement;
        lightboxImage.setAttribute("src", src);
        lightboxImage.setAttribute("alt", alt || "Screenshot preview");
        lightboxCaption.textContent = alt || src;
        lightbox.removeAttribute("hidden");
        lightbox.setAttribute("aria-hidden", "false");
        if (lightboxClose && typeof lightboxClose.focus === "function") {
          lightboxClose.focus();
        }
      };

      zoomTriggers.forEach((trigger) => {
        trigger.addEventListener("click", () => {
          const src = trigger.getAttribute("data-preview-src");
          if (!src) return;
          const alt = trigger.getAttribute("data-preview-alt") || "";
          openLightbox(src, alt);
        });
      });

      if (lightbox) {
        lightbox.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.matches("[data-lightbox-close]")) {
            closeLightbox();
          }
        });
      }
      if (lightboxClose) {
        lightboxClose.addEventListener("click", closeLightbox);
      }

      /* ---- Gauge + score counter animation ---- */
      const CIRCUMFERENCE = 2 * Math.PI * 44;
      const gaugeProgressEls = Array.from(document.querySelectorAll(".gauge-progress"));
      const gaugeValueEls = Array.from(document.querySelectorAll(".gauge-value strong"));
      const savedDash = gaugeProgressEls.map((el) => el.getAttribute("stroke-dasharray"));

      // Set initial state (empty ring)
      gaugeProgressEls.forEach((el) => el.setAttribute("stroke-dasharray", "0 " + CIRCUMFERENCE));
      gaugeValueEls.forEach((el) => { el.dataset.target = el.textContent || "0"; el.textContent = "0"; });

      function animateCountTo(el, target, duration) {
        const start = performance.now();
        function tick(now) {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = String(Math.round(target * eased));
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }

      const gaugeObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          gaugeObserver.unobserve(entry.target);
          const index = gaugeProgressEls.indexOf(entry.target);
          if (index >= 0 && savedDash[index]) {
            entry.target.setAttribute("stroke-dasharray", savedDash[index]);
          }
          if (index >= 0 && gaugeValueEls[index]) {
            const target = parseInt(gaugeValueEls[index].dataset.target || "0", 10);
            animateCountTo(gaugeValueEls[index], target, 1200);
          }
        });
      }, { threshold: 0.3 });

      gaugeProgressEls.forEach((el) => gaugeObserver.observe(el));

      /* ---- Human-readable timestamps ---- */
      document.querySelectorAll("time[data-iso]").forEach((el) => {
        try {
          const d = new Date(el.getAttribute("data-iso"));
          if (isNaN(d.getTime())) return;
          el.textContent = d.toLocaleDateString("en-US", {
            year: "numeric", month: "short", day: "numeric"
          }) + " at " + d.toLocaleTimeString("en-US", {
            hour: "numeric", minute: "2-digit", hour12: true
          });
        } catch (_) { /* keep raw ISO fallback */ }
      });

      /* ---- Copy summary ---- */
      if (copyButton) {
        copyButton.addEventListener("click", () => {
          const gauges = Array.from(document.querySelectorAll(".gauge-card"));
          const scores = gauges.map((g) => {
            const h3 = g.querySelector("h3");
            const val = g.querySelector(".gauge-value strong");
            return (h3 ? h3.textContent : "?") + ": " + (val ? val.dataset.target || val.textContent : "n/a") + "/100";
          }).join(" | ");
          const statusEl = document.querySelector(".status-chip");
          const urlEl = document.querySelector(".meta");
          const text = "WQG Report\\n" +
            (urlEl ? urlEl.textContent.trim() : "") + "\\n" +
            (statusEl ? statusEl.textContent.trim() : "") + "\\n" +
            scores;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
              copyButton.textContent = "Copied!";
              setTimeout(() => { copyButton.textContent = "Copy summary"; }, 2000);
            }).catch(() => {
              copyButton.textContent = "Copy failed";
              setTimeout(() => { copyButton.textContent = "Copy summary"; }, 2000);
            });
          }
        });
      }

      /* ---- Keyboard shortcuts ---- */
      const closeShortcuts = () => {
        if (!shortcutsOverlay) return;
        shortcutsOverlay.setAttribute("hidden", "true");
        shortcutsOverlay.setAttribute("aria-hidden", "true");
        if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      };

      const openShortcuts = () => {
        if (!shortcutsOverlay) return;
        lastFocused = document.activeElement;
        shortcutsOverlay.removeAttribute("hidden");
        shortcutsOverlay.setAttribute("aria-hidden", "false");
        const closeBtn = shortcutsOverlay.querySelector(".lightbox-close");
        if (closeBtn) closeBtn.focus();
      };

      if (shortcutsOverlay) {
        shortcutsOverlay.addEventListener("click", (event) => {
          const target = event.target;
          if (!(target instanceof Element)) return;
          if (target.matches("[data-shortcuts-close]") || target.matches(".lightbox-close")) {
            closeShortcuts();
          }
        });
      }

      const closeAllOverlays = () => {
        closeLightbox();
        closeShortcuts();
      };

      window.addEventListener("keydown", (event) => {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        switch (event.key) {
          case "Escape":
            closeAllOverlays();
            break;
          case "?":
            if (!shortcutsOverlay) break;
            if (shortcutsOverlay.hasAttribute("hidden")) openShortcuts();
            else closeShortcuts();
            break;
          case "t":
            themeButton.click();
            break;
          case "s": {
            const btn = viewButtons.find((b) => b.getAttribute("data-view-mode") === "simple");
            if (btn) btn.click();
            break;
          }
          case "d": {
            const btn = viewButtons.find((b) => b.getAttribute("data-view-mode") === "detailed");
            if (btn) btn.click();
            break;
          }
          case "c":
            if (copyButton) copyButton.click();
            break;
        }
      });
    })();
  </script>
</body>
</html>`;
}
