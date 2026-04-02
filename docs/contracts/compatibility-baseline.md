# Compatibility Baseline

This document freezes the consumer-facing contract surface. Future changes may add capabilities, but they should not break the interfaces listed here unless they also ship an explicit compatibility shim and migration note.

## Protected Interfaces

| Surface | Current baseline | Compatibility rule |
| --- | --- | --- |
| CLI binary | `wqg` resolves to `dist/cli.js` via `package.json#bin` | Keep the binary name and install path stable. |
| CLI command | `wqg audit [url]` | Preserve the command name and option names; additive flags only. |
| CLI stdout modes | `--format json` prints v1 `summary.json` shape; `--format md` prints markdown derived from v2 | Do not change the existing stdout contract. |
| CLI exit codes | `0`/orchestrator exit code for audit result, `2` for usage errors, `1` for runtime failures | Preserve the exit code semantics. |
| Summary v1 | `summary.json` plus `schemas/summary.v1.json` | Remains backward-compatible for existing consumers. |
| Summary v2 | `summary.v2.json` plus `schemas/summary.v2.json` | Additive evolution only in this cycle. |
| Default output artifacts | `summary.json`, `summary.v2.json`, `report.html`, `action-plan.md`, supporting artifact directories | Keep default artifact names and locations stable unless a shim is documented. |
| Package distribution | `dist`, `schemas`, `configs`, `README.md`, `LICENSE` ship in tarball | Preserve these install-time assets. |
| Action usage | `uses: Jahrome907/web-quality-gatekeeper@v3` | Keep stable major tag consumption valid. |
| Action inputs | `url`, `config-path`, `baseline-dir`, `policy`, `fail-on-a11y`, `fail-on-perf`, `fail-on-visual`, `allow-internal-targets`, `headers`, `cookies` | Preserve names and current semantics; additive-only inputs. |
| Action outputs | `status`, `summary-path` | Preserve names and current meanings. |

## Source Of Truth Order

The following order resolves ambiguity when docs, tests, and implementation differ:

| Surface | Source of truth order |
| --- | --- |
| CLI flags and exit behavior | `src/cli.ts` -> CLI integration tests -> `README.md` / examples |
| Action inputs, outputs, and path resolution | `action.yml` -> Action smoke workflow -> README / examples |
| Summary v1 | `src/report/summary.ts` + `schemas/summary.v1.json` -> `npm run contracts:check` -> docs |
| Summary v2 | `src/index.ts` + `src/report/summary.ts` + `schemas/summary.v2.json` -> `npm run contracts:check` -> docs |
| Package contents | `package.json#files` + `npm pack` output -> pack/publish smoke workflows -> docs |
| Workflow behavior | workflow YAML -> workflow-oriented tests / smoke -> contributing or README guidance |

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
- Schema version: `2.2.0`
- Contract doc: [`summary-v2-contract.md`](./summary-v2-contract.md)

Compatibility rule:

- `summary.json` must remain stable for current consumers.
- `summary.v2.json` may grow additively, but existing fields and meanings stay stable through this branch.

Automated contract discipline:

- `npm run contracts:check` fails if runtime schema constants, schema files, aggregate summary pointers, or contract docs drift out of sync.
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

Current behavioral assumptions to preserve:

- `config-path` and `baseline-dir` resolve relative to `GITHUB_WORKSPACE` unless already absolute.
- The built-in fallback for `configs/default.json` resolves to the action copy when the workspace file is absent.
- `summary-path` currently resolves to `artifacts/summary.json`.
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
  - asserts `status` is non-empty and `summary-path` exists in the workspace
- `npm-pack-smoke.yml`
  - proves the tarball contains `package/schemas/summary.v1.json` and `package/dist/cli.js`
  - proves a clean install exposes `wqg --version`
- `release.yml`
  - currently triggers on all `v*` tags
  - treats any hyphenated tag as a prerelease
  - still force-moves the stable major tag after release creation; this behavior is frozen as current baseline and scheduled for future hardening

## Packaging Baseline

Commands run on 2026-03-12 to capture the current shipping baseline:

```bash
npm pack --json
npm pack --silent
tar -tzf web-quality-gatekeeper-3.1.3.tgz | sort
TMP_DIR=$(mktemp -d /tmp/wqg-pack-XXXXXX)
cp web-quality-gatekeeper-3.1.3.tgz "$TMP_DIR/"
cd "$TMP_DIR"
npm init -y
npm install "./web-quality-gatekeeper-3.1.3.tgz" --ignore-scripts
./node_modules/.bin/wqg --version
```

Observed results:

- Tarball filename: `web-quality-gatekeeper-3.1.3.tgz`
- Tarball size: `245127` bytes
- Unpacked size: `1115215` bytes
- Entry count: `16`
- Clean install result: `wqg --version` printed `3.1.3`

Current tarball contents:

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

Current smoke depth, intentionally recorded as baseline rather than endorsement:

- Pack and publish smoke prove tarball creation, clean install, and `wqg --version`.
- They do not yet prove functional `wqg audit` behavior from the tarball.
- They do not yet assert the presence of every consumer-relevant schema/config asset individually.

## Known Baseline Ambiguities Resolved Here

- README examples may read as if the CLI URL is required. The runtime contract is authoritative: the URL is optional when config targets are supplied.
- `summary-v2` version truth comes from runtime constants and `schemas/summary.v2.json`; docs must align to `2.2.0`.
- `npm run contracts:check` is the required verification command for summary contract edits; there is no undocumented manual sync step.
- Consumer workflow examples are minimal, not feature-complete replicas of this repo's hardened workflows.

## Planned Follow-ups

- Correctness bugs in config loading, trend handling, action path resolution, and case-study ROI calculation.
- Release-tag safety, fork-safe PR comments, action pinning, and workflow permission hardening.
- Automated schema/doc/runtime drift detection.
- Deeper consumer confidence checks for packaged CLI and Action artifacts.
