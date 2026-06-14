# Testing Matrix

This matrix maps protected behavior to the narrowest test layer that should fail
when that behavior regresses.

## Command Map

- `npm test`: unit, integration, contract, and local smoke coverage
- `npm run test:coverage`: coverage report used by the repo CI gate
- `npm run python:smoke`: optional Python case-study analytics smoke coverage; set `WQG_PYTHON` when Python is not on `PATH`
- `npm run engines:check`: preflight check for the package Node.js floor
- `npm run validate:full`: engine preflight, lint, typecheck, build, tests, and runtime dependency audit
- `npm run contracts:check`: summary and PR Risk Ledger contract drift gate
- `npm run security:audit`: runtime dependency audit exceptions gate
- `npm run release:dry-run`: release-prep gate that runs full maintainer validation, contract checks, package smoke, Action smoke, and Python smoke
- `.github/workflows/action-smoke.yml`: composite Action smoke in workflow context
- `.github/workflows/npm-pack-smoke.yml`: tarball consumer smoke in workflow context
- `.github/workflows/quality-gate.yml`: repo CI, coverage, and runtime audit gate
- `.github/workflows/native-visual-diff.yml`: Rust native visual diff engine build, unit checks, and binary smoke across Linux, Windows, and macOS

## Behavior Matrix

| Behavior                                                                  | Primary layer                        | Files                                                                                                                      |
| ------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Built-in and workspace-relative Action policy resolution                  | unit + workflow smoke                | `tests/action.policy-resolution.test.ts`, `.github/workflows/action-smoke.yml`, `tests/workflow.invariants.test.ts`        |
| Invalid config inheritance (`extends`) rejection                          | unit + CLI integration               | `tests/config.test.ts`, `tests/integration.test.ts`                                                                        |
| Trend snapshot corruption, incompatibility, and concurrent prune handling | orchestration unit + CLI integration | `tests/trend.snapshot.regression.test.ts`, `tests/phase4.trend-lifecycle.test.ts`, `tests/integration.test.ts`             |
| Summary schema/runtime/doc alignment                                      | contract                             | `tests/summary.contract-drift.test.ts`                                                                                     |
| PR Risk Ledger schema/runtime/doc alignment                               | contract                             | `tests/prRiskLedger.test.ts`, `docs/contracts/pr-risk-ledger-v1-contract.md`, `schemas/pr-risk-ledger.v1.json`             |
| CLI single-target compatibility output                                    | integration                          | `tests/integration.test.ts`                                                                                                |
| CLI multi-target aggregate output                                         | integration                          | `tests/integration.test.ts`, `tests/phase4.orchestration.test.ts`                                                          |
| PR Risk Ledger JSON and Markdown artifacts                                | unit + integration                   | `tests/prRiskLedger.test.ts`, `tests/integration.test.ts`                                                                  |
| Consumer init scaffold                                                    | unit + CLI behavior                  | `tests/init.scaffold.test.ts`, `src/cli.ts`                                                                                |
| Local setup diagnostics (`wqg doctor`)                                    | unit + CLI behavior                  | `tests/doctor.test.ts`, `src/doctor.ts`, `src/cli.ts`                                                                      |
| Native visual diff adapter fallback and Rust binary health                | unit + workflow                      | `tests/visualDiff.native.test.ts`, `src/runner/nativeVisualDiffSupport.ts`, `.github/workflows/native-visual-diff.yml`, `native/wqg-visual-diff-native/src/main.rs` |
| Release validation Node.js engine preflight                               | unit + release gates                 | `tests/node-engine.test.ts`, `scripts/ci/assert-node-engine.mjs`, `package.json`, `scripts/ci/release-dry-run.mjs`         |
| Tarball contents and packaged CLI behavior                                | local smoke + workflow smoke         | `tests/package.smoke.test.ts`, `.github/workflows/npm-pack-smoke.yml`, `tests/workflow.invariants.test.ts`                 |
| Package entrypoints, type metadata, and shipped asset allowlist           | unit + local smoke                   | `tests/package.metadata.test.ts`, `scripts/ci/pack-smoke.mjs`, `package.json`                                             |
| Composite Action artifact output and summary linkage                      | workflow smoke + invariant guard     | `.github/workflows/action-smoke.yml`, `tests/workflow.invariants.test.ts`                                                  |
| Workflow pinning, release tag safety, and fork-safe PR comments           | workflow invariant                   | `tests/workflow.invariants.test.ts`                                                                                        |
| Python case-study analytics output integrity and cache-free smoke runs    | Python smoke + unit                  | `npm run python:smoke`, `tests/python-smoke.test.ts`, `tools/python/tests/test_case_study_analytics.py`                    |

## Layer Rules

- Prefer unit tests for pure config, schema, and aggregation helpers.
- Prefer integration tests for CLI exit codes, emitted artifacts, and format behavior.
- Prefer smoke coverage for packaged or workflow-driven consumer paths.
- Keep fixture-backed tests local and deterministic; do not require external network access.
- When a bug is fixed, add the narrowest regression first and then extend upward only if the failure could bypass that layer.
