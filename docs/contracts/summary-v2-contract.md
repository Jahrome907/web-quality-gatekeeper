# Summary v2 Contract

This document freezes the `summary.v2.json` contract emitted by `src/index.ts`.

- Current schema version: `2.0.0`
- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json`
- Local schema file: `schemas/summary.v2.json`

## Top-Level Contract

| Path | Type | Required | Notes |
| --- | --- | --- | --- |
| `$schema` | `string` | Yes | Always the v2 schema URI. |
| `schemaVersion` | `"2.0.0"` | Yes | Contract freeze point for this phase. |
| `toolVersion` | `string` | Yes | CLI/package semver string. |
| `mode` | `"single" \| "multi"` | Yes | `single` for one target, `multi` for multiple targets. |
| `overallStatus` | `"pass" \| "fail"` | Yes | Rollup status across pages. |
| `startedAt` | `string` | Yes | ISO date-time. |
| `durationMs` | `number` | Yes | Non-negative total run duration. |
| `primaryUrl` | `string` | Yes | Primary page URL for the run. |
| `schemaPointers` | `object` | Yes | Contains `v1` and `v2` schema URIs. |
| `schemaVersions` | `object` | Yes | Contains `v1` and `v2` schema versions. |
| `compatibility` | `object` | Yes | Documents v1 compatibility behavior. |
| `rollup` | `object` | Yes | Aggregate counters across pages. |
| `pages` | `array` | Yes | Per-page results with canonical details. |
| `trend` | `object` | Yes | Trend comparison state and deltas. |

## Page Entry Contract (`pages[]`)

| Path | Type | Required | Notes |
| --- | --- | --- | --- |
| `index` | `number` | Yes | Zero-based target index. |
| `name` | `string` | Yes | Target display name. |
| `url` | `string` | Yes | Page URL. |
| `overallStatus` | `"pass" \| "fail"` | Yes | Per-page status. |
| `startedAt` | `string` | Yes | ISO date-time. |
| `durationMs` | `number` | Yes | Non-negative page duration. |
| `steps` | `object` | Yes | `playwright`, `a11y`, `perf`, `visual`. |
| `artifacts` | `object` | Yes | `summary`, `summaryV2`, `report` relative paths. |
| `metrics` | `object` | Yes | Quick rollup metrics for dashboards. |
| `details` | `object` | Yes | Canonical per-page v2 payload. |

## Canonical Details Contract (`pages[].details`)

`pages[].details` is the canonical per-page structure.

- Includes: `$schema`, `schemaVersion`, `toolVersion`, `overallStatus`, `url`,
  `startedAt`, `durationMs`, `steps`, `artifacts`, `screenshots`, `a11y`,
  `performance`, `visual`, `runtimeSignals`.
- `artifacts.summaryV2` is always present.
- `a11y`, `performance`, and `visual` are nullable by policy.

## Accessibility Contract (`pages[].details.a11y`)

When present, `a11y` includes:

- `violations: number`
- `countsByImpact: { critical, serious, moderate, minor }`
- `reportPath: string`
- `details: AxeViolationDetail[]`
- `metadata: { totalViolations, keptViolations, droppedViolations, droppedNodes }`

`AxeViolationDetail`:

- `id: string`
- `description: string`
- `help: string`
- `helpUrl: string`
- `impact: string | null`
- `wcagTags: string[]` (sorted lexicographically)
- `tags: string[]`
- `nodes: Array<{ target: string[]; htmlSnippet: string; failureSummary: string | null }>`

### Truncation and Bounds

- Maximum stored violations: `100`
- Maximum nodes per violation: `50`
- Maximum selector targets per node: `10`
- `htmlSnippet` is whitespace-normalized and truncated to `500` chars (+ ellipsis)
- `failureSummary` is whitespace-normalized and truncated to `1000` chars (+ ellipsis)
- Dropped counts are recorded in `metadata`.

## Performance Contract (`pages[].details.performance`)

When present, `performance` includes:

- `metrics: { performanceScore, lcpMs, cls, tbtMs }`
- `budgets: { performance, lcpMs, cls, tbtMs }`
- `budgetResults: { performance, lcp, cls, tbt }`
- `reportPath: string`
- `categoryScores: { performance, accessibility, bestPractices, seo }`
- `extendedMetrics: { fcpMs, speedIndexMs, ttiMs, ttfbMs }`
- `opportunities: LighthouseOpportunity[]`

`LighthouseOpportunity`:

- `id: string`
- `title: string`
- `score: number`
- `displayValue: string`
- `estimatedSavingsMs: number | null`
- `estimatedSavingsBytes: number | null`

### Ordering and Bounds

- Maximum opportunities stored: `10`
- Sorted by combined savings descending
- Tie-breakers: `id` ascending, then `title` ascending

## Runtime Signals Contract (`pages[].details.runtimeSignals`)

`runtimeSignals.console`:

- `total: number`
- `errorCount: number`
- `warningCount: number`
- `dropped: number`
- `messages: Array<{ type: string; text: string; location: string | null }>`

`runtimeSignals.jsErrors`:

- `total: number`
- `dropped: number`
- `errors: Array<{ message: string; stack: string | null }>`

`runtimeSignals.network`:

- `totalRequests: number`
- `failedRequests: number`
- `transferSizeBytes: number`
- `resourceTypeBreakdown: Record<string, number>`

### Ordering, Sanitization, and Bounds

- `resourceTypeBreakdown` is emitted in deterministic key order.
- Console/JS text is normalized and truncated.
- Maximum console messages stored: `200`
- Maximum JS errors stored: `100`
- Dropped counts are tracked in `dropped` fields.
- `transferSizeBytes` is derived from `content-length` headers; totals may undercount
  when headers are missing or omitted.

## Null vs Omitted Policy

- Top-level required fields are always present.
- Optional check payloads use explicit `null` (`a11y`, `performance`, `visual`).
- Omitted fields are not used for required contract sections.

## Deterministic Ordering Guarantees

- `pages[]` preserves configured target order.
- `opportunities[]` ordering is deterministic (savings + tie-breakers).
- `a11y.details[].wcagTags[]` are sorted lexicographically.
- `runtimeSignals.network.resourceTypeBreakdown` keys are sorted lexicographically.

## Backward Compatibility Matrix

| Consumer | Artifact | Status | Migration |
| --- | --- | --- | --- |
| Existing v1 consumer | `summary.json` | Retained | No changes required. |
| New consumer needing richer extraction | `summary.v2.json` | Supported | Read `pages[].details` as canonical per-page payload. |
| Mixed adoption | Both | Supported | Keep v1 integrations on `summary.json`; add v2 in parallel. |

## Compatibility and `artifacts.summaryV2`

- `summary.json` remains the compatibility artifact.
- `summary.v2.json` is the richer aggregate artifact.
- `pages[].details.artifacts.summaryV2` and `pages[].artifacts.summaryV2`
  point to the per-page v2 summary path.

## Canonical Examples

### 1) Single-page pass (`summary.v2.json`)

```json
{
  "$schema": "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
  "schemaVersion": "2.0.0",
  "toolVersion": "0.3.0",
  "mode": "single",
  "overallStatus": "pass",
  "startedAt": "2026-02-08T00:00:00.000Z",
  "durationMs": 1234,
  "primaryUrl": "https://example.com",
  "schemaPointers": {
    "v1": "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
    "v2": "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json"
  },
  "schemaVersions": { "v1": "1.1.0", "v2": "2.0.0" },
  "compatibility": {
    "v1SummaryPath": "summary.json",
    "v1Schema": "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json",
    "v1SchemaVersion": "1.1.0",
    "note": "summary.json remains v1-compatible. summary.v2.json contains multipage and trend fields."
  },
  "rollup": {
    "pageCount": 1,
    "failedPages": 0,
    "a11yViolations": 0,
    "performanceBudgetFailures": 0,
    "visualFailures": 0
  },
  "pages": [
    {
      "index": 0,
      "name": "default",
      "url": "https://example.com",
      "overallStatus": "pass",
      "startedAt": "2026-02-08T00:00:00.000Z",
      "durationMs": 1234,
      "steps": {
        "playwright": "pass",
        "a11y": "skipped",
        "perf": "skipped",
        "visual": "skipped"
      },
      "artifacts": {
        "summary": "summary.json",
        "summaryV2": "summary.v2.json",
        "report": "report.html"
      },
      "metrics": {
        "a11yViolations": 0,
        "performanceScore": null,
        "maxMismatchRatio": null,
        "consoleErrors": 0,
        "jsErrors": 0,
        "failedRequests": 0
      },
      "details": {
        "$schema": "https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json",
        "schemaVersion": "2.0.0",
        "toolVersion": "0.3.0",
        "overallStatus": "pass",
        "url": "https://example.com",
        "startedAt": "2026-02-08T00:00:00.000Z",
        "durationMs": 1234,
        "steps": {
          "playwright": "pass",
          "a11y": "skipped",
          "perf": "skipped",
          "visual": "skipped"
        },
        "artifacts": {
          "summary": "summary.json",
          "summaryV2": "summary.v2.json",
          "report": "report.html",
          "axe": null,
          "lighthouse": null,
          "screenshotsDir": "screenshots",
          "diffsDir": "diffs",
          "baselineDir": "../baselines"
        },
        "screenshots": [],
        "a11y": null,
        "performance": null,
        "visual": null,
        "runtimeSignals": {
          "console": { "total": 0, "errorCount": 0, "warningCount": 0, "dropped": 0, "messages": [] },
          "jsErrors": { "total": 0, "dropped": 0, "errors": [] },
          "network": { "totalRequests": 0, "failedRequests": 0, "transferSizeBytes": 0, "resourceTypeBreakdown": {} }
        }
      }
    }
  ],
  "trend": {
    "status": "disabled",
    "historyDir": null,
    "previousSnapshotPath": null,
    "message": null,
    "metrics": null,
    "pages": []
  }
}
```

### 2) Multi-page mixed status (`summary.v2.json`)

```json
{
  "mode": "multi",
  "overallStatus": "fail",
  "rollup": {
    "pageCount": 2,
    "failedPages": 1,
    "a11yViolations": 2,
    "performanceBudgetFailures": 1,
    "visualFailures": 0
  },
  "pages": [
    { "index": 0, "name": "Landing", "overallStatus": "pass", "metrics": { "a11yViolations": 0, "performanceScore": 0.96, "maxMismatchRatio": 0.0, "consoleErrors": 0, "jsErrors": 0, "failedRequests": 0 }, "details": { "a11y": null, "performance": null, "visual": null, "runtimeSignals": { "console": { "total": 0, "errorCount": 0, "warningCount": 0, "dropped": 0, "messages": [] }, "jsErrors": { "total": 0, "dropped": 0, "errors": [] }, "network": { "totalRequests": 0, "failedRequests": 0, "transferSizeBytes": 0, "resourceTypeBreakdown": {} } } } },
    { "index": 1, "name": "Checkout", "overallStatus": "fail", "metrics": { "a11yViolations": 2, "performanceScore": 0.62, "maxMismatchRatio": 0.0, "consoleErrors": 1, "jsErrors": 0, "failedRequests": 1 }, "details": { "a11y": { "violations": 2, "countsByImpact": { "critical": 1, "serious": 1, "moderate": 0, "minor": 0 }, "reportPath": "pages/02-checkout/axe.json", "details": [], "metadata": { "totalViolations": 2, "keptViolations": 2, "droppedViolations": 0, "droppedNodes": 0 } }, "performance": null, "visual": null, "runtimeSignals": { "console": { "total": 3, "errorCount": 1, "warningCount": 0, "dropped": 0, "messages": [] }, "jsErrors": { "total": 0, "dropped": 0, "errors": [] }, "network": { "totalRequests": 31, "failedRequests": 1, "transferSizeBytes": 120000, "resourceTypeBreakdown": { "document": 1, "script": 10 } } } } }
  ]
}
```

### 3) Null sections with ready trend state (`summary.v2.json`)

```json
{
  "overallStatus": "pass",
  "pages": [
    {
      "index": 0,
      "name": "default",
      "overallStatus": "pass",
      "details": {
        "a11y": null,
        "performance": null,
        "visual": null,
        "runtimeSignals": {
          "console": { "total": 1, "errorCount": 0, "warningCount": 1, "dropped": 0, "messages": [] },
          "jsErrors": { "total": 0, "dropped": 0, "errors": [] },
          "network": { "totalRequests": 8, "failedRequests": 0, "transferSizeBytes": 42000, "resourceTypeBreakdown": { "document": 1, "script": 4 } }
        }
      }
    }
  ],
  "trend": {
    "status": "ready",
    "historyDir": ".history",
    "previousSnapshotPath": ".history/2026-02-08T00-00-00-000Z.summary.v2.json",
    "message": null,
    "metrics": {
      "overallStatusChanged": false,
      "durationMs": { "current": 1200, "previous": 1300, "delta": -100 },
      "failedPages": { "current": 0, "previous": 0, "delta": 0 },
      "a11yViolations": { "current": 0, "previous": 1, "delta": -1 },
      "performanceBudgetFailures": { "current": 0, "previous": 0, "delta": 0 },
      "visualFailures": { "current": 0, "previous": 0, "delta": 0 }
    },
    "pages": []
  }
}
```

## Semver Policy

- `2.0.0` is the frozen base for this phase.
- Additive, backward-compatible changes increment minor version (`2.x+1.0`).
- Breaking field/type/requiredness changes increment major version (`3.0.0`).

## Extraction Config Keys (Validated)

| Key | Type | Default | Bounds / Validation |
| --- | --- | --- | --- |
| `retries.count` | `number` | `1` | Integer, `0..5` |
| `retries.delayMs` | `number` | `2000` | Integer, `0..10000` |
| `axe.includeRules[]` | `string[]` | `[]` | Max 50 entries, no duplicates |
| `axe.excludeRules[]` | `string[]` | `[]` | Max 50 entries, no duplicates |
| `axe.includeTags[]` | `string[]` | `[]` | Max 50 entries, no duplicates |
| `axe.excludeTags[]` | `string[]` | `[]` | Max 50 entries, no duplicates |
| `visual.pixelmatch.includeAA` | `boolean` | `false` | Boolean |
| `visual.pixelmatch.threshold` | `number` | `0.1` | `0..1` |
| `visual.ignoreRegions[]` | `array` | `[]` | Max 25 regions; each region has integer `x,y >= 0`, integer `width,height > 0`, each `<= 100000` |

Default values are applied by runtime fallback logic (`retries.*`) and schema defaults (`visual.pixelmatch.*`).
