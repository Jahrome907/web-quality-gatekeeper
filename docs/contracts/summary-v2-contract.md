# Summary v2 Contract

This document freezes the `summary.v2.json` contract emitted by `src/index.ts`.

- Current schema version: `2.3.0`
- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json`
- Local schema file: `schemas/summary.v2.json`

## Source Of Truth

Use this order when implementation and docs disagree:

1. `src/index.ts` aggregate summary emission
2. `src/report/summary.ts` per-page v2 detail emission
3. `schemas/summary.v2.json`
4. Contract tests covering runtime output and schema validation
5. Documentation such as this contract file and `docs/migrations/summary-v2.md`

## Automated Drift Gate

Run `npm run contracts:check` to verify that:

- shared runtime schema pointers and versions still match `schemas/summary.v2.json`
- the aggregate `summary.v2.json` contract emitted by `src/index.ts` still points at the canonical runtime constants
- this contract doc and the compatibility baseline still reference the current URI and version

## Top-Level Contract

| Path             | Type                  | Required | Notes                                                                         |
| ---------------- | --------------------- | -------- | ----------------------------------------------------------------------------- |
| `$schema`        | `string`              | Yes      | Always the v2 schema URI.                                                     |
| `schemaVersion`  | `"2.3.0"`             | Yes      | Contract freeze point for this phase.                                         |
| `toolVersion`    | `string`              | Yes      | CLI/package semver string.                                                    |
| `mode`           | `"single" \| "multi"` | Yes      | `single` for one target, `multi` for multiple targets.                        |
| `overallStatus`  | `"pass" \| "fail"`    | Yes      | Rollup status across pages.                                                   |
| `startedAt`      | `string`              | Yes      | ISO date-time.                                                                |
| `durationMs`     | `number`              | Yes      | Non-negative total run duration.                                              |
| `primaryUrl`     | `string`              | Yes      | Primary page URL for the run.                                                 |
| `schemaPointers` | `object`              | Yes      | Contains `v1` and `v2` schema URIs.                                           |
| `schemaVersions` | `object`              | Yes      | Contains `v1` and `v2` schema versions.                                       |
| `compatibility`  | `object`              | Yes      | Documents v1 compatibility behavior.                                          |
| `rollup`         | `object`              | Yes      | Aggregate counters across pages.                                              |
| `pages`          | `array`               | Yes      | Per-page results with canonical details.                                      |
| `artifacts`      | `object`              | Yes      | Aggregate artifact pointers including review, trend, and action-plan outputs. |
| `trend`          | `object`              | Yes      | Trend comparison state, history window, and actionable insights.              |
| `insights`       | `object \| null`      | Yes      | Run-level prioritized remediation recommendations.                            |

## Page Entry Contract (`pages[]`)

| Path            | Type               | Required | Notes                                            |
| --------------- | ------------------ | -------- | ------------------------------------------------ |
| `index`         | `number`           | Yes      | Zero-based target index.                         |
| `name`          | `string`           | Yes      | Target display name.                             |
| `url`           | `string`           | Yes      | Page URL.                                        |
| `overallStatus` | `"pass" \| "fail"` | Yes      | Per-page status.                                 |
| `startedAt`     | `string`           | Yes      | ISO date-time.                                   |
| `durationMs`    | `number`           | Yes      | Non-negative page duration.                      |
| `steps`         | `object`           | Yes      | `playwright`, `a11y`, `perf`, `visual`.          |
| `artifacts`     | `object`           | Yes      | `summary`, `summaryV2`, `report` relative paths. |
| `metrics`       | `object`           | Yes      | Quick rollup metrics for dashboards.             |
| `details`       | `object`           | Yes      | Canonical per-page v2 payload.                   |

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

| Consumer                               | Artifact          | Status    | Migration                                                   |
| -------------------------------------- | ----------------- | --------- | ----------------------------------------------------------- |
| Existing v1 consumer                   | `summary.json`    | Retained  | No changes required.                                        |
| New consumer needing richer extraction | `summary.v2.json` | Supported | Read `pages[].details` as canonical per-page payload.       |
| Mixed adoption                         | Both              | Supported | Keep v1 integrations on `summary.json`; add v2 in parallel. |

## Compatibility and `artifacts.summaryV2`

- `summary.json` remains the compatibility artifact.
- `summary.v2.json` is the richer aggregate artifact.
- `artifacts.prRiskLedgerJson` and `artifacts.prRiskLedgerMd` point to the merge-review risk ledger outputs.
- `pages[].details.artifacts.summaryV2` and `pages[].artifacts.summaryV2`
  point to the per-page v2 summary path.

## Example

Use the checked-in [`fixture-summary.v2.json`](../proof/fixture-summary.v2.json) as the complete example. It is validated against the shipped schema and stays aligned with the proof report. Partial JSON copies are intentionally not maintained here.

## Semver Policy

- Additive, backward-compatible fields increment the v2 schema minor version.
- Breaking field, type, or requiredness changes require a new schema major.
- Update runtime constants, schemas, contract docs, fixtures, and the migration guide together.
