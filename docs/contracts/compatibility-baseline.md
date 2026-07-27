# Public Compatibility Baseline

This document tells maintainers which consumer interfaces must remain stable. The implementation, schemas, and tests listed below are authoritative; this page is an index, not a duplicate specification.

Summary v1:

- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json`
- Schema version: `1.1.0`

Summary v2:

- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json`
- Schema version: `2.3.0`

## Protected interfaces

| Surface           | Compatibility promise                                                                                                        | Source of truth                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| CLI               | Preserve `wqg audit`, `wqg init`, `wqg doctor`, existing option names, stdout formats, and exit-code meanings.               | `src/cli.ts` and CLI integration tests                                                            |
| Summary v1        | Keep `summary.json` backward-compatible.                                                                                     | `src/report/summary.ts`, `schemas/summary.v1.json`, and [the v1 contract](summary-v1-contract.md) |
| Summary v2        | Evolve `summary.v2.json` additively within its current major schema line.                                                    | `schemas/summary.v2.json` and [the v2 contract](summary-v2-contract.md)                           |
| PR Risk Ledger    | Keep the JSON artifact machine-readable and the Markdown companion human-readable.                                           | `schemas/pr-risk-ledger.v1.json` and [the ledger contract](pr-risk-ledger-v1-contract.md)         |
| Default artifacts | Preserve `summary.json`, `summary.v2.json`, `report.html`, `action-plan.md`, `pr-risk-ledger.json`, and `pr-risk-ledger.md`. | Runtime integration tests                                                                         |
| Composite Action  | Preserve documented input names and the outputs listed below.                                                                | `action.yml` and Action smoke tests                                                               |
| Package           | Preserve the advertised binary, root API types, schemas, configs, README, and license when npm distribution becomes public.  | `package.json` and package smoke tests                                                            |

The stable Action reference is `Jahrome907/web-quality-gatekeeper@v3`. GitHub tags and Releases, not the version on `main`, define published versions.

## Action contract

Inputs:

- `url`
- `config-path`
- `baseline-dir`
- `policy`
- `fail-on-a11y`, `fail-on-perf`, and `fail-on-visual`
- `allow-internal-targets`
- `headers` and `cookies`

Outputs:

- `status`
- `summary-path` and `summary-v2-path`
- `report-path` and `action-plan-path`
- `pr-risk-ledger-path` and `pr-risk-ledger-md-path`
- `sensitive-audit`

Consumer-relative config and baseline paths resolve from the consumer workspace. The Action writes ordinary output under `artifacts/`. Auth inputs, internal-target overrides, or explicit sensitive-audit controls set `sensitive-audit` so consumers can suppress publication.

## Change rules

- Additive fields require aligned runtime types, schemas, docs, fixtures, and tests.
- Breaking JSON changes require a new schema major and migration guide.
- New CLI or Action capabilities should be additive; do not silently repurpose existing options or outputs.
- Package and Action changes must pass their consumer smoke tests.
- Security controls for target validation and sensitive outputs are compatibility boundaries, not implementation details.

Run `npm run contracts:check` for summary or PR Risk Ledger contract edits. Use `npm run smoke:action` for Action changes and `npm run smoke:pack` for package-surface changes. The [summary v2 migration guide](../migrations/summary-v2.md) covers the existing v1-to-v2 transition.
