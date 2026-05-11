# Provenance

This repository keeps its public evidence inspectable. Published proof artifacts are checked into `docs/proof/` and are generated from repository-owned fixtures, configuration, and scripts.

## Proof Bundle

The published proof bundle includes:

- `docs/proof/fixture-report.html`
- `docs/proof/fixture-summary.v2.json`
- `docs/proof/fixture-lighthouse.json`
- `docs/proof/fixture-action-plan.md`
- `docs/proof/fixture-proof-config.json`

The fixture walkthrough in `docs/case-study-run.md` documents the reproducible local path.

## Local Reproduction

```bash
npm ci
npx playwright install
npm run build
npm run case-study:fixture
```

The case-study script writes a provenance manifest with the source fixture path, config path, command, and output paths for the generated bundle.

## Release Evidence

GitHub tags and Releases are the public source of truth for published versions. The stable major Action tag is moved only from validated release workflow runs.
