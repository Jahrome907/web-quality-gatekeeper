<!-- markdownlint-configure-file {"MD024": {"siblings_only": true}} -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.2] - 2026-03-14

### Added

- Maintainer-facing release documentation:
  - architecture/change-surface map in `docs/engineering/ARCHITECTURE_MAP.md`
  - release verification handoff in `docs/engineering/RELEASE_HANDOFF.md`

### Changed

- Release-prep workflow hardening:
  - least-privilege permissions on smoke workflows
  - composite Action checkout disables credential persistence
  - npm publish enforces release-tag and `package.json` version parity
  - public Action guidance now targets the stable `@v3` contract
- Audit target safety hardening:
  - sensitive-mode SSRF checks now cover redirect destinations, unresolved
    targets, and the final Lighthouse URL
  - browser-backed audits pin host resolution consistently across Playwright and
    Lighthouse
- Pack/action smoke helpers now clean leaked scratch directories before running
  and provision Playwright explicitly in the pack-consumer path
- Contributor setup guidance now documents OS-aware Playwright installation.

### Fixed

- Production audit gate stability:
  - pinned transitive `yauzl` to `3.2.1` via `overrides` so
    `npm audit --omit=dev` passes on the Lighthouse dependency chain
- Output directory validation now rejects symlink escapes outside the workspace

## [3.1.1] - 2026-03-08

### Fixed

- GitHub Actions integration test stability:
  - integration fixture runs now explicitly disable inherited CI guards unless a test opts into CI-mode behavior
- Release pipeline continuity:
  - patch release cut from post-fix `main` so `Release`/`NPM Publish` workflows can complete for the 3.1 line

## [3.1.0] - 2026-03-08

### Added

- Prioritized remediation recommendations with action-plan output:
  - run/page-level `insights` in `summary.v2.json`
  - HTML “Action Plan” section
  - `action-plan.md` artifact
- Rolling trend dashboard outputs:
  - `trends/history.json`
  - `trends/dashboard.html`
  - trend `history` and trend `insights` contract fields
- First-class policy templates:
  - built-in profiles: `marketing`, `docs`, `ecommerce`, `saas`
  - CLI flags: `--policy <name|path>` and `--list-policies`
  - config layering via `extends`
- Public case-study reproducibility assets:
  - ROI calculator script (`scripts/case-study/roi-from-summaries.mjs`)
  - protocol doc (`docs/case-study/public-oss-repro.md`)

### Changed

- Summary v2 schema/version advanced to `2.2.0` with additive compatibility-preserving fields.
- Policy templates are host-agnostic defaults (paths/budgets/toggles) and no longer hardcode `urls`.

## [3.0.0] - 2026-02-08

### Added

- Rich interactive HTML report UX:
  - simple/detailed view toggle
  - sticky section jump navigation
  - clickable score gauges with per-category drilldowns
  - expandable screenshot galleries (8 visible by default, "View all" for overflow)
  - click-to-enlarge lightbox for screenshots and visual diffs
  - hover/focus tooltips and legend for resource breakdown
- High-volume screenshot gallery capture controls in config:
  - `screenshotGallery.enabled`
  - `screenshotGallery.maxScreenshotsPerPath`
- Focused UI and runner test coverage for interactive report behavior and screenshot gallery capture paths.

### Changed

- Root `report.html` generation now uses the richer v2 summary payload so extended Lighthouse vitals (including FCP, Speed Index, TTI, TTFB) render without dropping to `n/a` in normal runs.
- Runtime orchestration internals were split into `src/audit/orchestration.ts` and tests were decomposed into smaller deterministic suites for maintainability and readability.
- Release docs now target stable major-tag usage for v3 examples.

## [0.3.0] - 2026-02-08

### Added

- Composite Action smoke workflow using `uses: ./` with output assertions (`status`, `summary-path`)
- Unit tests for `runAudit()` orchestration with dependency stubs
- Runner behavior tests for Playwright and Lighthouse modules using mocks
- Coverage thresholds in Vitest: `lines: 72`, `functions: 70`, `branches: 60`, `statements: 70`
- Versioned JSON Schema file at `schemas/summary.v1.json`
- Schema validation tests for generated summaries (unit + integration)
- Authenticated audit support:
  - CLI flags: `--header`, `--cookie`
  - Environment inputs: `WQG_AUTH_HEADERS`, `WQG_AUTH_COOKIES`, `WQG_AUTH_HEADER`, `WQG_AUTH_COOKIE`
- npm pack install smoke workflow
- npm publish workflow
- Public case-study and benchmark artifact doc at `docs/case-study-run.md`
- Multi-page audit orchestration via `config.urls` with deterministic per-page ordering
- Trend snapshot persistence (`trends.enabled`) with run-over-run delta computation
- Aggregate summary artifact at `artifacts/summary.v2.json`
- Migration guide for summary v2 at `docs/migrations/summary-v2.md`

### Changed

- `action.yml` now executes install/build/audit from `${{ github.action_path }}` for external-repo compatibility
- Composite Action resolves consumer config/baseline paths from `${{ github.workspace }}` and writes artifacts to `${{ github.workspace }}/artifacts`
- Summary output now includes `$schema` URI
- README examples now use stable action tag `@v1` instead of `@main`
- CLI `audit` command accepts optional `url` when `config.urls` is present
- Markdown output now renders per-page sections, status badges, and trend deltas
- `summary.json` remains v1-compatible while v2 fields are emitted in `summary.v2.json`

### Fixed

- Remediated transitive `lodash-es` advisory (`GHSA-xxjr-mmjv-4gpg`) via dependency update

## [0.2.0] - 2026-02-07

### Added in 0.2.0

- `schemaVersion` and `toolVersion` fields in summary JSON output
- `--format` flag: output as `json`, `html`, or `md`
- Markdown report formatter (`--format md`)
- Backward-compatibility contract tests for summary JSON schema
- Integration test against local fixture server (no network dependency)
- Consumer example workflow for action usage
- `outputs` in `action.yml` (`status`, `summary-path`)
- Automated release workflow (tag → GitHub release + major tag)
- Architecture overview and comparison section in README
- Programmatic API documentation in README

### Changed in 0.2.0

- Harden `action.yml` input handling (array quoting, env vars)
- Action usage references `@main` until first stable tag

### Fixed in 0.2.0

- Shell injection risk in `action.yml` from unquoted inputs

## [0.1.0] - 2025-01-15

### Added in 0.1.0

- CLI entrypoint with Commander (`wqg audit <url>`)
- Playwright smoke runner with deterministic screenshot capture
- axe-core accessibility scanning with severity-level counts
- Lighthouse performance auditing with budget enforcement
- Visual regression diffing with pixelmatch and baseline management
- Zod-based config validation with security limits
- HTML report generation with inline CSS
- JSON summary output with pass/fail status per step
- SSRF protection via URL and hostname validation
- Path traversal prevention for output directories
- SHA-256 baseline integrity verification
- CI workflow with PR comment posting
- Dependabot configuration for automated dependency updates

[3.0.0]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v0.3.0...v3.0.0
[0.3.0]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Jahrome907/web-quality-gatekeeper/releases/tag/v0.1.0
[3.1.0]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.0.0...v3.1.0
[Unreleased]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.2...HEAD
[3.1.2]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.1...v3.1.2
