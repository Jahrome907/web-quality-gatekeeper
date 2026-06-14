# Provenance

This repository keeps its public evidence inspectable. Published proof artifacts are checked into `docs/proof/` and trace back to repository-owned fixtures, configuration, and scripts.

## Proof Bundle

The published proof bundle includes:

- `docs/proof/fixture-report.html`
- `docs/proof/fixture-summary.v2.json`
- `docs/proof/fixture-lighthouse.json`
- `docs/proof/fixture-action-plan.md`
- `docs/proof/fixture-pr-risk-ledger.json`
- `docs/proof/fixture-pr-risk-ledger.md`
- `docs/proof/fixture-proof-config.json`

The fixture walkthrough in `docs/case-study-run.md` documents the reproducible local path.

## Local Reproduction

```bash
npm run engines:check
npm ci
npx playwright install chromium
npm run build
npm run case-study:fixture
```

The case-study script writes a provenance manifest with the source fixture path,
config path, Node engine preflight result, command, and output paths for the
report, summaries, Action Plan, PR Risk Ledger, required screenshot evidence,
and optional Lighthouse payload when performance auditing is enabled.

## Release Evidence

GitHub tags and Releases are the public source of truth for published versions. The stable major Action tag is moved only from validated release workflow runs.
