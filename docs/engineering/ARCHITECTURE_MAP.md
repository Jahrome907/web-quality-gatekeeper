# Architecture Map

This document is the maintainer-facing "where do I change this?" map for the
main subsystems in `web-quality-gatekeeper`.

## Request Flow

1. `src/cli.ts` parses flags, environment-derived defaults, and command-mode
   behavior for `wqg audit`.
2. `src/index.ts` validates paths, loads config/policy overlays, resolves
   targets, and orchestrates the audit lifecycle.
3. `src/runner/*` performs the browser-backed work:
   - `playwright.ts` opens pages, captures screenshots, and records runtime
     signals.
   - `axe.ts` runs accessibility scans.
   - `lighthouse.ts` runs performance audits.
   - `visualDiff*.ts` manages baseline comparisons and the optional native
     adapter seam.
4. `src/report/*` converts runner output into HTML, Markdown, `summary.json`,
   and `summary.v2.json`.
5. `action.yml`, `.github/workflows/*`, and `scripts/ci/*` verify how the
   package and composite Action behave in consumer environments.

## Subsystems

### CLI, Config, and Target Safety

- `src/cli.ts`: CLI flag definitions, environment defaults, and exit-code
  behavior.
- `src/config/*`: default config, schema validation, built-in policies, and
  config inheritance.
- `src/utils/url.ts`: SSRF-aware target classification, internal-target
  blocking, and host-resolution pinning.
- `src/utils/fs.ts`: output-path validation, safe writes, and workspace/symlink
  boundaries.

Change here when:

- you add or change CLI flags or Action-exposed runtime behavior
- you touch config validation, policy layering, or target resolution
- you need to tighten audit safety rules

### Audit Orchestration and Runners

- `src/index.ts`: top-level orchestration and summary assembly.
- `src/audit/orchestration.ts`: aggregation, multi-page coordination, and trend
  lifecycle wiring.
- `src/runner/playwright.ts`: browser launch, navigation, screenshots, runtime
  console/network signals.
- `src/runner/lighthouse.ts`: Chrome launch, Lighthouse execution, metrics, and
  portable runtime handling.
- `src/runner/visualDiff.ts` and `src/runner/visualDiffEngine.ts`: baseline
  loading, diffing, and JS/native engine selection.

Change here when:

- you modify how audits run end-to-end
- you need new runtime evidence in reports
- you are fixing navigation, redirect, or browser-environment edge cases

### Reporting and Contracts

- `src/report/*`: HTML, Markdown, remediation guidance, summaries, trend
  dashboard, and report templating.
- `schemas/*`: shipped JSON Schema files for summary contracts.
- `docs/contracts/*`: protected-interface docs and schema ownership notes.
- `docs/migrations/summary-v2.md`: consumer-facing compatibility guidance.

Change here when:

- you change emitted report content or summary fields
- you add additive schema fields or contract docs
- you need to update public proof artifacts or migration notes

### Consumer and Release Surfaces

- `action.yml`: composite Action inputs, outputs, and consumer-path behavior.
- `.github/workflows/*`: repo-owned CI, release, publish, pack smoke, and Pages
  automation.
- `scripts/ci/*`: local smoke helpers and release dry-run entrypoints.
- `examples/consumer-workflow.yml`: published example for downstream consumers.

Change here when:

- you change packaging, release, or workflow behavior
- you need to keep repo automation aligned with shipped artifacts
- you are hardening permissions, tag handling, or publish safety

## Verification Map

- Run `npm run check` for most code changes.
- Run `npm run contracts:check` whenever summary/runtime/doc alignment changes.
- Run `npm run security:audit` for runtime dependency or security-surface work.
- Run `npm run smoke:pack` for package or tarball-path changes.
- Run `npm run smoke:action` for composite Action or workflow-consumer changes.
- Run `npm run release:dry-run` before release-prep closeout.
- See `docs/testing-matrix.md` for the finer-grained behavior-to-test mapping.
