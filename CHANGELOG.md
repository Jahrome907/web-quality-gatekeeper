<!-- markdownlint-configure-file {"MD024": {"siblings_only": true}} -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `wqg doctor` checks Node.js, config validity, output paths, browser availability, and optional native visual diff readiness before heavier audit runs.
- `wqg audit --format json-v2`, `--format pr-risk-ledger`, and `--format action-plan` expose the richer summary and remediation artifacts directly on stdout for scripting.
- `schemas/pr-risk-ledger.v1.json` and `docs/contracts/pr-risk-ledger-v1-contract.md` define the stable PR Risk Ledger JSON contract.
- Package metadata now advertises the public API declaration file through `package.json#types` and the root export's `types` field.
- Composite Action outputs now expose stable paths for the v2 summary, report, Action Plan, and PR Risk Ledger artifacts.

### Changed

- `wqg init --profile <name> --url <url>` can write a concrete audited URL into the generated consumer config, workflow, and setup guidance.
- Generated `wqg init` workflows now upload report artifacts by default while keeping a sensitive-output opt-out.
- README, Pages, the checked-in consumer example, and generated scaffold workflows now show the same sensitive-output-aware artifact upload pattern with current pinned checkout and upload-artifact actions.
- Public and generated consumer workflows now upload the Action-emitted summary, report, Action Plan, and PR Risk Ledger artifact paths instead of relying on a hard-coded output directory.
- Summary v2 schema/version advanced to `2.3.0` and now exposes PR Risk Ledger artifact pointers in the aggregate artifact map.
- Fixture case-study provenance now records the Node engine preflight result and PR Risk Ledger artifact paths alongside report, summary, Action Plan, Lighthouse, and screenshot evidence.
- Public baseline/improved case-study provenance now requires Action Plan and PR Risk Ledger paths alongside report and summary paths.
- Fixture case-study provenance now fails closed when required review and screenshot artifacts are missing.
- `npm run validate:full` and `npm run release:dry-run` run the Node engine preflight before expensive release validation.
- `npm run release:dry-run` now includes the Python analytics smoke alongside contract, package, and Action smoke checks.
- `npm run release:dry-run` avoids rerunning the runtime audit already enforced by `validate:full`.
- The quality-gate workflow now relies on `validate:full` for runtime audit enforcement instead of rerunning the audit in a second step.
- The manual npm publish workflow now uses `validate:full` plus `contracts:check` instead of hand-rolled validation commands, and publishes prereleases under the npm `next` dist-tag instead of `latest`.
- The native visual diff workflow now pins Node 24 before running its npm smoke helper.
- The native visual diff workflow now also runs for native runtime support helper changes.
- Source-checkout, proof-reproduction docs, and repo-owned workflows now run the Node engine preflight before dependency install, browser install, build, or fixture commands.
- Package smoke coverage now runs on both Node 22.19 and Node 24 so the advertised minimum runtime is checked alongside the release runtime.
- The README repo-development command list now includes `engines:check` and `validate:full`.
- The pull request checklist now routes Python analytics changes to `npm run python:smoke`.
- Pack smoke now verifies shipped schemas, config assets, root API type metadata, CLI shebang integrity, installed `wqg init` artifact-upload scaffolding, and an installed TypeScript consumer compile.
- Public proof and provenance wording now describes source fixtures and proof bundles in product-facing language.
- Compatibility baseline follow-ups now distinguish completed contract-drift work from remaining release provenance and SBOM publication work.

### Fixed

- Native visual diff execution is disabled in CI unless `WQG_ALLOW_NATIVE_VISUAL_ENGINE=true` is set, script adapters are refused by default, and doctor diagnostics mirror the runtime fallback rules.
- Protocol-relative screenshot paths are rejected so config and runtime validation keep screenshots on the audited target.
- Python smoke diagnostics now report interpreter launch failures, honor `WQG_PYTHON` for explicit interpreter selection, and avoid writing bytecode caches during validation.
- Pack and integration smoke helpers rebuild stale `dist` output when source or build metadata changes, and local Action smoke now runs from an isolated built-runtime snapshot so parallel builds cannot remove its CLI mid-run.
- The npm `prepack` lifecycle now rebuilds `dist` before packing or publishing so source checkouts cannot emit tarballs without the CLI/API bundle.
- `npm run native:visual-diff:build` now resolves the default Windows rustup Cargo path and builds the native engine with `--locked`.
- Auth headers and cookies now follow verified navigation redirects so authenticated audits keep session context on trusted landing origins.
- Emitted summaries, aggregate reports, trend entries, and PR Risk Ledger inputs now record the audited landing URL after redirects.
- Stable major Action tag publication now refuses backward movement before creating the GitHub Release, and the release workflow no longer retriggers on bare major aliases.
- The composite Action no longer checks out and cleans the caller workspace before reading relative config or policy inputs.
- The trusted-publishing runtime preflight now resolves `npm.cmd` on Windows.
- Maintainer documentation now has automated guards for local Markdown links, documented npm scripts, helper scripts, referenced test files, historical release framing, and stale roadmap entries.
- Maintainer testing guidance now describes `contracts:check` as the combined summary and PR Risk Ledger contract gate.

## [3.1.6] - 2026-05-29

### Added

- `wqg init --profile <marketing|docs|ecommerce|saas>` scaffolds consumer workflow, config, baseline, and README files without overwriting existing files unless `--force` is provided.
- `pr-risk-ledger.json` and `pr-risk-ledger.md` are emitted alongside the existing report artifacts to summarize merge-review risk from page status, runtime signals, remediation insights, and trend insights.
- Public roadmap, provenance, and SBOM notes document the project direction and current release-evidence boundaries.
- Native visual diff engine CI now runs Cargo build and test checks for the Rust engine.

### Changed

- The optional Rust visual diff path is now presented as `native-rust` under `native/wqg-visual-diff-native`, with the prior `native-rust-spike` config id accepted as a compatibility alias.
- Windows local smoke cleanup retries transient file-lock failures and does not fail an otherwise successful package smoke solely because a scratch directory could not be removed immediately.
- Node 22.19 is now the minimum supported runtime, with repo-owned workflows and the composite Action running on Node 24.
- Release, npm publish, quality-gate, pack-smoke, action-smoke, and Pages workflows use narrower permissions and non-persistent checkout credentials; npm publish now uses trusted publishing instead of a long-lived `NPM_TOKEN`.
- Local composite-Action smoke is strict by default; `WQG_ACTION_SMOKE_ALLOW_SKIP=true` is reserved for explicit optional local probes.

### Fixed

- Auth headers and cookies remain scoped to the originally requested audit target after cross-origin redirects.
- CI-sensitive target blocking now treats GitHub Actions as sensitive mode even when `CI=false` is present in the environment.
- Screenshot filenames remain distinct after sanitization, avoiding overwritten screenshots, baselines, and visual diffs.
- Markdown report output escapes target-derived text and path code spans so crafted page names, URLs, insights, or artifact paths cannot corrupt report structure.
- DNS-resolved private initial targets, malformed native visual-diff output, and HTML report generation now have direct regression coverage.

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
[Unreleased]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.6...HEAD
[3.1.6]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.3...v3.1.4
[3.1.2]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.1...v3.1.2
[3.1.3]: https://github.com/Jahrome907/web-quality-gatekeeper/compare/v3.1.2...v3.1.3
