# Compatibility Baseline

This document freezes the consumer-facing contract surface. Future changes may add capabilities, but they should not break the interfaces listed here unless they also ship an explicit compatibility shim and migration note.

## Protected Interfaces

| Surface                  | Current baseline                                                                                                                                                               | Compatibility rule                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| CLI binary               | `wqg` resolves to `dist/cli.js` via `package.json#bin`                                                                                                                         | Keep the binary name and install path stable.                                   |
| CLI command              | `wqg audit [url]`, `wqg init --profile <name>`                                                                                                                                 | Preserve existing command names and option names; additive flags only.          |
| CLI stdout modes         | `--format json` prints v1 `summary.json` shape; `--format json-v2`, `pr-risk-ledger`, and `action-plan` expose richer artifacts; `--format md` prints markdown derived from v2 | Do not change existing stdout contracts; add new formats for richer automation. |
| CLI exit codes           | `0`/orchestrator exit code for audit result, `2` for usage errors, `1` for runtime failures                                                                                    | Preserve the exit code semantics.                                               |
| Summary v1               | `summary.json` plus `schemas/summary.v1.json`                                                                                                                                  | Remains backward-compatible for existing consumers.                             |
| Summary v2               | `summary.v2.json` plus `schemas/summary.v2.json`                                                                                                                               | Additive evolution only in this cycle.                                          |
| Default output artifacts | `summary.json`, `summary.v2.json`, `report.html`, `action-plan.md`, `pr-risk-ledger.json`, `pr-risk-ledger.md`, supporting artifact directories                                | Keep default artifact names and locations stable unless a shim is documented.   |
| Package distribution     | `dist`, `schemas`, `configs`, `README.md`, `LICENSE` ship in tarball, with root API types advertised through `package.json#types` and `package.json#exports["."].types`        | Preserve these install-time assets and type metadata.                           |
| Action usage             | `uses: Jahrome907/web-quality-gatekeeper@v3`                                                                                                                                   | Keep stable major tag consumption valid.                                        |
| Action inputs            | `url`, `config-path`, `baseline-dir`, `policy`, `fail-on-a11y`, `fail-on-perf`, `fail-on-visual`, `allow-internal-targets`, `headers`, `cookies`                               | Preserve names and current semantics; additive-only inputs.                     |
| Action outputs           | `status`, `summary-path`, `summary-v2-path`, `report-path`, `action-plan-path`, `pr-risk-ledger-path`, `pr-risk-ledger-md-path`                                                | Preserve names and current meanings.                                            |

## Source Of Truth Order

The following order resolves ambiguity when docs, tests, and implementation differ:

| Surface                                     | Source of truth order                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| CLI flags and exit behavior                 | `src/cli.ts` -> CLI integration tests -> `README.md` / examples                                               |
| Action inputs, outputs, and path resolution | `action.yml` -> Action smoke workflow -> README / examples                                                    |
| Summary v1                                  | `src/report/summary.ts` + `schemas/summary.v1.json` -> `npm run contracts:check` -> docs                      |
| Summary v2                                  | `src/index.ts` + `src/report/summary.ts` + `schemas/summary.v2.json` -> `npm run contracts:check` -> docs     |
| PR Risk Ledger                              | `src/report/prRiskLedger.ts` + `schemas/pr-risk-ledger.v1.json` -> `npm run contracts:check` -> README / docs |
| Package contents                            | `package.json#files` + `npm pack` output -> pack/publish smoke workflows -> docs                              |
| Workflow behavior                           | workflow YAML -> workflow-oriented tests / smoke -> contributing or README guidance                           |

## CLI Baseline

Current `wqg audit --help` surface:

- Optional positional `url`; runtime allows config-driven invocation when `config.urls` is provided.
- Stable flags:
  - `--config <path>`
  - `--out <dir>`
  - `--baseline-dir <dir>`
  - `--policy <nameOrPath>`
  - `--list-policies`
  - `--set-baseline`
  - `--allow-internal-targets`
  - `--no-fail-on-a11y`
  - `--no-fail-on-perf`
  - `--no-fail-on-visual`
  - `--format <type>`
  - `--header <header>`
  - `--cookie <cookie>`
  - `--verbose`

Current CLI behavior to preserve:

- `--format json` prints the v1 summary shape to stdout for compatibility.
- `--format md` prints markdown rendered from the richer v2 summary.
- `wqg init --profile <marketing|docs|ecommerce|saas>` writes consumer-owned config, workflow, baseline, and README files without overwriting existing scaffold files unless `--force` is provided.
- Usage validation failures return exit code `2`.
- Unexpected runtime failures return exit code `1`.

## Summary Baseline

### `summary.json`

- Canonical artifact for backward compatibility.
- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v1/schemas/summary.v1.json`
- Schema version: `1.1.0`
- Contract doc: [`summary-v1-contract.md`](./summary-v1-contract.md)

### `summary.v2.json`

- Canonical richer contract for multi-page, trend, and insights consumers.
- Schema URI: `https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v2/schemas/summary.v2.json`
- Schema version: `2.3.0`
- Contract doc: [`summary-v2-contract.md`](./summary-v2-contract.md)

Compatibility rule:

- `summary.json` must remain stable for current consumers.
- `summary.v2.json` may grow additively, but existing fields and meanings stay stable through this branch.

Automated contract discipline:

- `npm run contracts:check` fails if runtime schema constants, schema files, aggregate summary pointers, PR Risk Ledger schema/docs, or contract docs drift out of sync.
- Summary schema/version updates are not complete until the runtime constants, schema files, docs, and drift gate all agree.

## Action Baseline

Current composite Action contract:

- Inputs:
  - `url`
  - `config-path`
  - `baseline-dir`
  - `policy`
  - `fail-on-a11y`
  - `fail-on-perf`
  - `fail-on-visual`
  - `allow-internal-targets`
  - `headers`
  - `cookies`
- Outputs:
  - `status`
  - `summary-path`
  - `summary-v2-path`
  - `report-path`
  - `action-plan-path`
  - `pr-risk-ledger-path`
  - `pr-risk-ledger-md-path`

Current behavioral assumptions to preserve:

- `config-path` and `baseline-dir` resolve relative to `GITHUB_WORKSPACE` unless already absolute.
- The built-in fallback for `configs/default.json` resolves to the action copy when the workspace file is absent.
- `summary-path` currently resolves to `artifacts/summary.json`.
- The richer artifact path outputs currently resolve to `artifacts/summary.v2.json`, `artifacts/report.html`, `artifacts/action-plan.md`, `artifacts/pr-risk-ledger.json`, and `artifacts/pr-risk-ledger.md`.
- `status` is read from `overallStatus` in that file.

## Workflow Baseline

Current repo workflow behaviors worth freezing before later hardening:

- `quality-gate.yml`
  - target resolution order: `WQG_URL` override -> local docs preview (`docs/index.html`) -> local `demo` script -> Pages URL fallback -> `https://example.com`
  - PR and `main` push events prefer the local docs preview when it exists so repo CI remains hermetic and audits the checked-in surface, not the last deployed Pages revision
  - non-PR/manual events still follow the remaining resolution order after any explicit `WQG_URL` override
  - sensitive-output publishing is opt-in for sensitive/authenticated runs
  - audit artifacts publish under `artifacts`
- `action-smoke.yml`
  - proves the local composite Action runs against the fixture site
  - asserts `status`, summary, summary v2, report, action-plan, and PR Risk Ledger path outputs
  - asserts default summary/report/action-plan/PR Risk Ledger artifacts align with shipped schemas
- `npm-pack-smoke.yml`
  - proves tarball creation, clean install, `wqg --version`, and a packaged `wqg audit` fixture run
  - validates emitted summaries and shipped schema/config assets used by the fixture
- `release.yml`
  - triggers on version-like `v*.*.*` tags, not stable major aliases such as `v3`
  - treats any hyphenated tag as a prerelease
  - creates the GitHub Release without requiring npm publication
  - validates stable major-tag movement before creating the GitHub Release
  - moves the stable major tag only after release validation and GitHub Release creation

## Packaging Baseline

The archived 3.1.4 capture below is historical release evidence, not the full
current tarball manifest. Current package contents are enforced by
`scripts/ci/pack-smoke.mjs`, which now also requires
`schemas/pr-risk-ledger.v1.json` and root API type metadata.

Commands run on 2026-04-29 to capture the 3.1.4 shipping baseline:

```bash
npm pack --json
npm pack --silent
tar -tzf web-quality-gatekeeper-3.1.4.tgz | sort
TMP_DIR=$(mktemp -d /tmp/wqg-pack-XXXXXX)
cp web-quality-gatekeeper-3.1.4.tgz "$TMP_DIR/"
cd "$TMP_DIR"
npm init -y
npm install "./web-quality-gatekeeper-3.1.4.tgz" --ignore-scripts
./node_modules/.bin/wqg --version
```

Observed results:

- Tarball filename: `web-quality-gatekeeper-3.1.4.tgz`
- Tarball size: `294688` bytes
- Unpacked size: `1360994` bytes
- Entry count: `17`
- Clean install result: `wqg --version` printed `3.1.4`

Historical 3.1.4 tarball contents:

- `LICENSE`
- `README.md`
- `configs/default.json`
- `configs/policies/docs.json`
- `configs/policies/ecommerce.json`
- `configs/policies/marketing.json`
- `configs/policies/saas.json`
- `configs/security/audit-exceptions.json`
- `dist/cli.js`
- `dist/cli.js.map`
- `dist/index.d.ts`
- `dist/index.js`
- `dist/index.js.map`
- `package.json`
- `schemas/summary.v1.json`
- `schemas/summary.v2.json`

Current smoke depth:

- Pack and publish smoke prove tarball creation, clean install, `wqg --version`, and a packaged `wqg audit` fixture run.
- Pack smoke validates the emitted summaries, default report/action-plan/PR
  Risk Ledger artifacts, root API type metadata, and shipped schema/config
  assets used by the fixture.

## Known Baseline Ambiguities Resolved Here

- README examples may read as if the CLI URL is required. The runtime contract is authoritative: the URL is optional when config targets are supplied.
- `summary-v2` version truth comes from runtime constants and `schemas/summary.v2.json`; docs must align to `2.3.0`.
- `npm run contracts:check` is the required verification command for summary or PR Risk Ledger contract edits; there is no undocumented manual sync step.
- Consumer workflow examples are minimal, not feature-complete replicas of this repo's hardened workflows.

## Remaining Follow-ups

- Keep consumer confidence checks expanding as new release surfaces are added.
- Add release provenance artifacts and SBOM publication once those release surfaces are ready.
