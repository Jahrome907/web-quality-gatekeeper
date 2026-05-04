<!-- markdownlint-configure-file {"MD024": {"siblings_only": true}} -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.5] - 2026-05-04

### Changed

- Upgraded the all-dependencies group to current majors, including `zod` v3 → v4 and `typescript` v5 → v6, alongside the rest of the dev/runtime bumps tracked in dependabot's grouped update.
- Upgraded the all-actions group to current pinned SHAs across `quality-gate`, `npm-pack-smoke`, `npm-publish`, `pages`, `release`, `action-smoke`, and the composite `action.yml`.
- Repository default user agent now advertises `wqg/3.1.5`.
- README badge advertises the `3.1.5` source version to match `package.json`.

### Fixed

- `formatZodError` now accepts the `PropertyKey`-shaped `path` segments produced by `ZodError` under `zod` v4, and stringifies each segment defensively when composing the error message.
- `@axe-core/playwright` is now imported as a named binding so the dual `default` / `AxeBuilder` export resolves cleanly under TypeScript 6 + NodeNext (previously raised "cannot use namespace as a type").
- `tsup` dts pipeline now passes `ignoreDeprecations: "6.0"` to TypeScript so the `baseUrl` injected by `rollup-plugin-dts` does not abort the `dts` build under TypeScript 6.
- `scripts/ci/_shared.mjs` and `scripts/enforce-runtime-audit.mjs` re-throw with `{ cause }` so error provenance is preserved end-to-end through the CI helpers.

### Repository hygiene

- Removed merged release branches (`release/3.1.4`, `release/3.1.4-action-release`, `release/6.1.2`) and superseded dependabot branches now that their PRs are closed or merged.

## [3.1.4] - 2026-04-29

### Changed

- Public OSS docs now document GitHub Action usage and source-checkout CLI usage as the supported consumer paths for the published release.
- README and docs site examples now use consumer-owned config locations or built-in policies instead of repo-internal maintainer paths.
- Public proof links now target the GitHub Pages docs site where the rendered artifacts are easiest to inspect.
- Community conduct reporting now points to maintainer contact routes instead of GitHub Security Advisories.
- Maintainer release dry runs now require the local Action smoke browser only in CI or when `WQG_ACTION_SMOKE_REQUIRED=true`; local Windows dry runs can use the smoke script's provisioned-environment skip path.
- Maintainer release dry runs now give the full validation suite enough time to complete package-smoke and integration audits before continuing.
- Playwright and Lighthouse target verification now share the same navigation target verifier while preserving their existing host trust behavior.

### Fixed

- Multi-target root `report.html` now renders aggregate target coverage instead of showing only the first page as the entire report.
- Action-plan markdown and aggregate markdown now include trend insights when trend analysis produces them.
- Runtime audit gating now runs through the exception-aware `security:audit` script, and the runtime lockfile is clean for current audit advisories.
- Windows artifact writes now retry transient `EPERM`/`EBUSY`/`EACCES` rename failures without deleting the existing artifact if replacement ultimately fails.

## [3.1.3] - 2026-04-02

### Added

- Optional native visual diff engine support:
  - config surface for `visual.engine` and `visual.nativeBinaryPath`
  - runtime fallback seam from the Rust binary to `pixelmatch`
  - public docs and benchmark guidance for the opt-in native path

### Changed

- Release and evidence surfaces now align on `3.1.3` across package metadata, published proof assets, and compatibility documentation.
- Local Action smoke now skips when Playwright's Chromium binary is unavailable instead of failing preflight in environments without browsers.

### Fixed

- Dependabot runtime alerts:
  - refreshed the locked `lodash-es` transitive dependency to `4.18.1` on the Lighthouse chain
- GitHub Action Windows compatibility:
  - shell path normalization no longer rewrites `GITHUB_WORKSPACE` into a Node-hostile path before the CLI runs
  - `wslpath` and `cygpath` normalization now fail open instead of aborting mixed Windows shells
- Sensitive Lighthouse target validation:
  - repeated requests to newly discovered hosts are re-resolved instead of inheriting trust from a cache that Chrome never received
- Auth header handling:
  - explicit CLI auth headers now override environment-provided values
  - explicit `Cookie` headers are preserved regardless of header casing
- Visual diff hardening:
  - corrupt baseline integrity manifests now fail closed and skip comparisons until the baseline metadata is repaired

## [3.1.2] - 2026-03-14

### Added

- Maintainer-facing release documentation:
  - architecture/change-surface map in `docs/engineering/ARCHITECTURE_MAP.md`
  - release verification handoff guidance under `docs/engineering/`

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
[Unreleased]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.4...HEAD
[3.1.4]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.3...v3.1.4
[3.1.2]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.1...v3.1.2
[3.1.3]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.2...v3.1.3
