# Case Study Run: Fixture Site Happy Path

This is the maintainer-grade happy path for a clean-clone reproducibility check. It uses the
local deterministic fixture in `tests/fixtures/site`, the deterministic integration config in
`tests/fixtures/integration-config.json`, and a single scripted command that spins the fixture
server, runs a real audit, and writes a machine-readable provenance manifest.

## Prerequisites

```bash
npm ci
npx playwright install
npm run build
```

## Run It

```bash
npm run case-study:fixture
```

Default output directory:

- `artifacts/case-study/fixture/artifacts/report.html`
- `artifacts/case-study/fixture/artifacts/summary.v2.json`
- `artifacts/case-study/fixture/fixture-provenance.json`

Override the output directory when you want an isolated run:

```bash
node scripts/case-study/run-fixture-case-study.mjs --out-dir .tmp-case-study
```

## What The Script Does

1. Starts a local static server for `tests/fixtures/site`.
2. Runs `wqg audit` against that server with `tests/fixtures/integration-config.json`.
3. Writes the normal artifact bundle under the output directory.
4. Writes `fixture-provenance.json` with the source fixture path, config path, command, and key result metrics.

## Reproducibility Checklist

- `npm ci` completed without local dependency drift.
- `npx playwright install` completed for the current machine.
- `npm run build` completed before running the fixture script.
- `fixture-provenance.json` exists and records the command, config path, and output paths.
- `summary.v2.json` and `report.html` exist under the output directory.
- The fixture run result matches the expected happy path:
  - `overallStatus: "pass"`
  - `a11yViolations: 0`
  - `performanceBudgetFailures: 0`

## Notes

- This fixture run is for reproducibility and proof-surface verification, not ROI comparison across two commits.
- The fixture happy path intentionally keeps performance and visual checks off so the clean-clone script remains stable across machines.
- For public baseline/improved case studies, use the stricter protocol in `docs/case-study/public-oss-repro.md`.
