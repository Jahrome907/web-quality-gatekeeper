# Provenance

Public proof should trace back to repository-owned fixtures, configuration, and commands. The checked-in proof bundle under `docs/proof/` contains the sample report, summary, Lighthouse payload, action plan, PR Risk Ledger, config, and required screenshot evidence linked from the project site.

## Reproduce the fixture bundle

```bash
npm run engines:check
npm ci
npx playwright install chromium
npm run build
npm run case-study:fixture
```

The fixture command writes ordinary audit artifacts and `fixture-provenance.json`. That manifest records the fixture and config paths, runtime preflight, command, output paths, required screenshot evidence, and the optional Lighthouse payload when performance auditing is enabled. See [the walkthrough](case-study-run.md) for expected results.

## Verify release evidence

GitHub [tags](https://github.com/Jahrome907/web-quality-gatekeeper/tags) and [Releases](https://github.com/Jahrome907/web-quality-gatekeeper/releases) are the public version record. Inspect the assets attached to the specific Release you consume; do not infer released artifacts from the version or workflows on `main`.

From a source checkout, `npm run release:evidence` writes `artifacts/release/release-provenance.json` and `artifacts/release/sbom.spdx.json`. The provenance file records the tag, package version, commit, validation profile, and expected release files. These local outputs prove the source command ran; they are not evidence that a GitHub Release or npm package was published.
