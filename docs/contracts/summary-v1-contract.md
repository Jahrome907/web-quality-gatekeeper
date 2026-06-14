# Summary v1 Contract

This document freezes the `summary.json` compatibility contract emitted from `src/report/summary.ts`.

- Current schema version: `1.1.0`
- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json`
- Local schema file: `schemas/summary.v1.json`

## Source Of Truth

Use this order when implementation and docs disagree:

1. `src/report/summary.ts`
2. `schemas/summary.v1.json`
3. Contract tests covering summary generation and schema validation
4. Documentation such as `README.md`

## Automated Drift Gate

Run `npm run contracts:check` to verify that:

- runtime schema constants still match `schemas/summary.v1.json`
- the published contract docs still reference the current URI and version
- aggregate compatibility pointers still resolve back to the canonical runtime constants

## Top-Level Contract

| Path            | Type               | Required | Notes                                            |
| --------------- | ------------------ | -------- | ------------------------------------------------ |
| `$schema`       | `string`           | Yes      | Always the v1 schema URI.                        |
| `schemaVersion` | `"1.x.x"`          | Yes      | Current runtime value is `1.1.0`.                |
| `toolVersion`   | `string`           | Yes      | Package semver string.                           |
| `overallStatus` | `"pass" \| "fail"` | Yes      | Rollup status across enabled checks.             |
| `url`           | `string`           | Yes      | Primary audited URL.                             |
| `startedAt`     | `string`           | Yes      | ISO date-time.                                   |
| `durationMs`    | `number`           | Yes      | Non-negative total duration.                     |
| `steps`         | `object`           | Yes      | Contains `playwright`, `a11y`, `perf`, `visual`. |
| `artifacts`     | `object`           | Yes      | Relative artifact paths for the run.             |
| `screenshots`   | `array`            | Yes      | Captured screenshot metadata.                    |
| `a11y`          | `object \| null`   | Yes      | Explicit `null` when a11y is disabled.           |
| `performance`   | `object \| null`   | Yes      | Explicit `null` when perf is disabled.           |
| `visual`        | `object \| null`   | Yes      | Explicit `null` when visual diff is disabled.    |

## Step Status Contract

`steps` always contains:

- `playwright`
- `a11y`
- `perf`
- `visual`

Each value is one of:

- `pass`
- `fail`
- `skipped`

## Artifact Path Contract

`artifacts` always contains:

- `summary`
- `report`
- `axe`
- `lighthouse`
- `screenshotsDir`
- `diffsDir`
- `baselineDir`

Current single-page defaults exposed to consumers:

- `summary`: `summary.json`
- `report`: `report.html`
- `screenshotsDir`: `screenshots`
- `diffsDir`: `diffs`

In multipage runs, the top-level `summary.json` remains a v1 compatibility
view of the primary target. `summary` and `report` point at the top-level
compatibility artifacts, while page-owned artifacts such as `screenshotsDir`,
`diffsDir`, and screenshot paths stay relative to the run root and include the
primary page directory, for example `pages/01-landing/screenshots`.

`axe` and `lighthouse` are nullable when their corresponding checks are disabled.

## Check Payload Contract

### `a11y`

When present, `a11y` contains:

- `violations`
- `countsByImpact`
- `reportPath`

`countsByImpact` always contains:

- `critical`
- `serious`
- `moderate`
- `minor`

### `performance`

When present, `performance` contains:

- `metrics`
- `budgets`
- `budgetResults`
- `reportPath`

`metrics` contains:

- `performanceScore`
- `lcpMs`
- `cls`
- `tbtMs`

### `visual`

When present, `visual` contains:

- `results`
- `threshold`
- `failed`
- `maxMismatchRatio`

Each visual result contains:

- `name`
- `currentPath`
- `baselinePath`
- `diffPath`
- `mismatchRatio`
- `status`

## Null And Omitted Policy

- Top-level contract fields are always present.
- Optional check payloads are represented with explicit `null`.
- Additional properties are not part of the v1 compatibility contract.
- In multipage runs, `summary.json` preserves the v1-compatible primary-target
  shape. Use `summary.v2.json` for aggregate and per-page multipage data.

## Semver Policy

- Additive, backward-compatible clarifications remain in `1.x`.
- Breaking changes to `summary.json` are out of scope for this branch.
- Newer or richer reporting belongs in `summary.v2.json`, not by mutating the v1 shape.
