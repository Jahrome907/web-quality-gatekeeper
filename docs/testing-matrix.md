# Testing Matrix

This matrix maps protected behavior to the narrowest test layer that should fail
when that behavior regresses.

## Command Map

- `npm test`: unit, integration, contract, and local smoke coverage
- `npm run python:smoke`: optional Python case-study analytics smoke coverage
- `npm run contracts:check`: summary schema/runtime/doc drift gate
- `.github/workflows/action-smoke.yml`: composite Action smoke in workflow context
- `.github/workflows/npm-pack-smoke.yml`: tarball consumer smoke in workflow context
- `.github/workflows/quality-gate.yml`: repo CI, coverage, and runtime audit gate
- `.github/workflows/native-visual-diff.yml`: Rust native visual diff engine build and unit checks

## Behavior Matrix

| Behavior | Primary layer | Files |
| --- | --- | --- |
| Built-in and workspace-relative Action policy resolution | unit + workflow smoke | `tests/action.policy-resolution.test.ts`, `.github/workflows/action-smoke.yml`, `tests/workflow.invariants.test.ts` |
| Invalid config inheritance (`extends`) rejection | unit + CLI integration | `tests/config.test.ts`, `tests/integration.test.ts` |
| Trend snapshot corruption, incompatibility, and concurrent prune handling | orchestration unit + CLI integration | `tests/trend.snapshot.regression.test.ts`, `tests/phase4.trend-lifecycle.test.ts`, `tests/integration.test.ts` |
| Summary schema/runtime/doc alignment | contract | `tests/summary.contract-drift.test.ts` |
| CLI single-target compatibility output | integration | `tests/integration.test.ts` |
| CLI multi-target aggregate output | integration | `tests/integration.test.ts`, `tests/phase4.orchestration.test.ts` |
| PR Risk Ledger JSON and Markdown artifacts | unit + integration | `tests/prRiskLedger.test.ts`, `tests/integration.test.ts` |
| Consumer init scaffold | unit + CLI behavior | `tests/init.scaffold.test.ts`, `src/cli.ts` |
| Native visual diff engine integration and Rust binary health | unit + workflow | `tests/visualDiff.native.test.ts`, `.github/workflows/native-visual-diff.yml`, `native/wqg-visual-diff-native/src/main.rs` |
| Tarball contents and packaged CLI behavior | local smoke + workflow smoke | `tests/package.smoke.test.ts`, `.github/workflows/npm-pack-smoke.yml`, `tests/workflow.invariants.test.ts` |
| Composite Action artifact output and summary linkage | workflow smoke + invariant guard | `.github/workflows/action-smoke.yml`, `tests/workflow.invariants.test.ts` |
| Workflow pinning, release tag safety, and fork-safe PR comments | workflow invariant | `tests/workflow.invariants.test.ts` |
| Python case-study analytics output integrity | Python smoke | `npm run python:smoke`, `tools/python/tests/test_case_study_analytics.py` |

## Layer Rules

- Prefer unit tests for pure config, schema, and aggregation helpers.
- Prefer integration tests for CLI exit codes, emitted artifacts, and format behavior.
- Prefer smoke coverage for packaged or workflow-driven consumer paths.
- Keep fixture-backed tests local and deterministic; do not require external network access.
- When a bug is fixed, add the narrowest regression first and then extend upward only if the failure could bypass that layer.
