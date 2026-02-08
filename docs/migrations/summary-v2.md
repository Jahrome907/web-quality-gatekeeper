# Summary JSON v2 Migration Guide

## Scope

This guide covers the summary contract changes introduced with summary v2 output while preserving v1 compatibility.

## What Changed

- New aggregate artifact: `summary.v2.json`.
- Multi-page rollup fields (`mode`, `rollup`, `pages[]`) added in v2.
- Trend delta block (`trend`) added in v2.
- Per-page v2 artifacts emitted in multi-page mode.

## What Stayed Stable

- `summary.json` remains the v1-compatible artifact.
- Existing pass/fail semantics for `overallStatus` and step statuses are unchanged.
- Existing CLI consumers reading v1 stdout (`--format json`) keep the same shape.

## Compatibility Guarantee

- `summary.json` remains the v1-compatible artifact.
- Existing consumers that parse `summary.json` do not need changes.
- New fields for multi-page audits and trend deltas are emitted in `summary.v2.json`.

## New Output Artifacts

- `summary.v2.json`: aggregate run summary with per-page sections and trend deltas.
- `pages/*/summary.v2.json`: page-level v2 detail files in multi-page mode.
- `.wqg-history/*.summary.v2.json`: historical snapshots when trend tracking is enabled.

## New Config Keys

- `urls`: ordered list of named targets.
- `trends.enabled`: enables snapshot persistence and delta computation.
- `trends.historyDir`: directory for historical snapshots (resolved relative to `--out` when not absolute).
- `trends.maxSnapshots`: retention cap for historical snapshot files.

## Field Mapping Examples (v1 -> v2)

| v1 field | v2 location | Notes |
|---|---|---|
| `overallStatus` | `overallStatus` | Same semantics |
| `steps` | `pages[].details.steps` | Per-page detail in multi mode |
| `a11y.violations` | `pages[].details.a11y.violations` and `rollup.a11yViolations` | Per-page + aggregate |
| `performance.metrics.performanceScore` | `pages[].details.performance.metrics.performanceScore` | Per-page |
| `visual.maxMismatchRatio` | `pages[].details.visual.maxMismatchRatio` | Per-page |
| n/a | `trend.*` | New run-over-run deltas |

## v2 Shape Highlights

`summary.v2.json` includes:

- `mode`: `single` or `multi`.
- `rollup`: aggregate counts across pages.
- `pages[]`: per-page status, metrics, artifact paths, and v2 detail payload.
- `trend`: run-over-run deltas and guardrail states (`disabled`, `no_previous`, `incompatible_previous`, `corrupt_previous`, or `ready`).
- `compatibility`: explicit pointer to v1 compatibility contract.
- Page identity matching for trend deltas uses `name::url`.

## Rollout Recommendation

1. Keep existing integrations pointed at `summary.json` first.
2. Add optional parsing for `summary.v2.json` in downstream dashboards.
3. Enable `trends.enabled` once v2 parsing is in place.
4. Monitor `trend.status` and handle `incompatible_previous` or `corrupt_previous` gracefully.

## Rollback Guidance

- If a downstream consumer has issues with v2 parsing, continue reading only `summary.json`.
- Keep v2 generation enabled if desired; v1 consumers are unaffected.
- Re-enable v2 consumer parsing incrementally once compatibility fixes are in place.
