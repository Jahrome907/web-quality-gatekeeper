# Web Quality Gatekeeper

[![Quality Gate](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml)
[![Action Smoke](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/action-smoke.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/action-smoke.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-17693b.svg)](LICENSE)
[![Node.js 22.19+](https://img.shields.io/badge/Node.js-22.19%2B-215732?logo=node.js&logoColor=white)](https://nodejs.org/)

Web Quality Gatekeeper runs Playwright smoke checks, axe accessibility scans, Lighthouse budgets, and visual comparisons in one CI job. It produces an HTML report plus JSON and Markdown artifacts for automation.

These instructions target 5.0.0. The npm and `@v5` examples require its publication; check [Releases](https://github.com/Jahrome907/web-quality-gatekeeper/releases) and [npm](https://www.npmjs.com/package/web-quality-gatekeeper) before using them. For the published v4 line, use the [4.0.0 instructions](https://github.com/Jahrome907/web-quality-gatekeeper/blob/v4.0.0/README.md). Read the [v5 migration guide](docs/migrations/v5.md) when upgrading a native visual-diff configuration.

Set up and review visual baselines before enabling the normal gate:

```bash
npm install --save-dev web-quality-gatekeeper@^5
npx playwright install chromium
npx wqg audit https://your-site.example --set-baseline --baseline-dir .github/web-quality/baselines
# review the resulting baseline images, then commit them
npx wqg audit https://your-site.example --baseline-dir .github/web-quality/baselines
```

The first audit writes the current screenshots to the baseline directory. A normal visual-enabled audit fails without a baseline; do not commit ordinary `artifacts/` output.

[![Web Quality Gatekeeper report showing audit status and category scores](docs/assets/report-screenshot.png)](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-report.html)

The screenshot links to a committed fixture report from version 3.2.4. Its supporting JSON, configuration, and reproduction steps are included in this repository.

The [project-site case study](https://jahrome907.github.io/web-quality-gatekeeper/case-study/project-pages.html) compares two actual site revisions and demonstrates a missing-alt regression producing a failed audit, an actionable report, and exit code 1. It includes the complete evidence bundle and reproduction script.

## Use it in GitHub Actions

After reviewing and committing your baselines, add this job. The [consumer example](examples/consumer-workflow.yml) also shows optional policies and authentication settings.

```yaml
jobs:
  web-quality:
    runs-on: ubuntu-latest
    env:
      WQG_SENSITIVE_AUDIT: "false"
      WQG_ALLOW_SENSITIVE_OUTPUTS: "false"
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
        with:
          persist-credentials: false
      - id: wqg
        uses: Jahrome907/web-quality-gatekeeper@v5
        with:
          url: https://your-site.example
          baseline-dir: .github/web-quality/baselines
      - name: Upload audit artifacts
        if: always() && steps.wqg.outputs.bundle-complete == 'true' && (steps.wqg.outputs.sensitive-audit == 'false' || env.WQG_ALLOW_SENSITIVE_OUTPUTS == 'true')
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: wqg-artifacts
          path: ${{ steps.wqg.outputs.artifact-paths }}
          if-no-files-found: error
```

The `policy` input is optional; this example uses the Action defaults. The upload condition retains completed failing audits while excluding interrupted output. Authenticated or internal audits should keep publication disabled unless the output is deliberately safe to share.

To intentionally omit visual comparison, set `toggles.visual` to `false` in the configuration. `--no-fail-on-visual` only permits completed visual diffs; it does not bypass a missing baseline.

## Run from source

```bash
git clone https://github.com/Jahrome907/web-quality-gatekeeper.git
cd web-quality-gatekeeper
npm run engines:check
npm ci
npx playwright install chromium
npm run build
node dist/cli.js audit https://your-site.example --set-baseline --baseline-dir .github/web-quality/baselines
# review the resulting baseline images, then commit them
node dist/cli.js audit https://your-site.example --baseline-dir .github/web-quality/baselines
```

Audits write results under `artifacts/`, including when a completed check fails its quality gate:

- `report.html`
- `summary.json` and `summary.v2.json`
- `action-plan.md`
- `pr-risk-ledger.json` and `pr-risk-ledger.md`
- screenshots, Lighthouse/axe payloads, and visual diffs when enabled

Open `artifacts/report.html` for the human report. Automation should consume the JSON artifacts and validate stable contracts against the schemas in [`schemas/`](schemas/summary.v2.json).

An HTTP status of 400 or higher for the navigated document fails the audit. Lighthouse also fails when a required measurement is missing or invalid instead of substituting a value. Console and JavaScript runtime counts are diagnostics for investigation; they are not standalone default gates.

## CLI essentials

```bash
npx wqg audit [url] [options]
npx wqg init --profile marketing --url https://your-site.example
npx wqg doctor --config .github/web-quality/config.json
```

The positional URL is optional when the config supplies `urls`. Common audit options include:

- `--config <path>` and `--policy <name|path>`
- `--out <dir>` and `--baseline-dir <dir>`
- `--set-baseline`
- `--format <json|json-v2|html|md|pr-risk-ledger|action-plan>`
- `--header "Name: Value"` and `--cookie "name=value"`
- `--allow-internal-targets`
- `--no-fail-on-a11y`, `--no-fail-on-perf`, and `--no-fail-on-visual` for completed category results

Built-in policies are `marketing`, `docs`, `ecommerce`, and `saas`. Screenshot paths must be `@target` or start with a single `/`; protocol-relative paths such as `//example.com/path` are rejected.

Use one output directory per sequential audit stream. Completed runs replace only
previously recorded generated files; unrelated files and trend history are preserved.
Keep baselines outside the output directory. If an older output directory has no
ownership receipt, use a fresh `--out` directory instead of deleting or adopting its
contents automatically. Interrupted runs remain incomplete and must not be uploaded.
If a terminated process leaves an output lock, use a fresh output directory; remove
the old lock only after confirming its writer has stopped.
The Action's upload list excludes unrelated files and saved trend snapshots. Trend
reports can include historical measurements; apply the sensitive-output policy to that history too.

## What it checks

- Playwright navigation and runtime error capture
- Screenshot capture
- axe-core accessibility violations
- Lighthouse performance budgets
- Pixel-level visual diffs
- Multi-page rollups
- Trend history
- Prioritized remediation
- PR risk summaries

The target host comes from the audit URL or config. Built-in policies supply paths, budgets, and toggles; they never replace the requested host.

## Security

Only audit sites you trust. Reports can contain page content, screenshots, URLs, and authenticated data. Internal/private targets are blocked by default in CI and authenticated runs unless explicitly allowed. Read [SECURITY.md](SECURITY.md) before using credentials or internal targets.

## Proof and contracts

Inspect the published [fixture report](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-report.html), [summary v2](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-summary.v2.json), [PR Risk Ledger](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-pr-risk-ledger.json), and [proof config](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-proof-config.json).

Reproduce that bundle with [the fixture walkthrough](docs/case-study-run.md). Public comparison studies should follow the [evidence protocol](docs/case-study/public-oss-repro.md). Contract and trust references:

- [Compatibility baseline](docs/contracts/compatibility-baseline.md)
- [Summary v1](docs/contracts/summary-v1-contract.md), [summary v2](docs/contracts/summary-v2-contract.md), and [PR Risk Ledger](docs/contracts/pr-risk-ledger-v1-contract.md)
- [Architecture map](docs/engineering/ARCHITECTURE_MAP.md) and [testing matrix](docs/testing-matrix.md)
- [Provenance](docs/provenance.md) and [SBOM](docs/sbom.md)
- [Optional Python analytics tooling](tools/python/README.md) for case-study artifact post-processing; the core CLI and Action do not require Python
- [Native visual-diff removal: migration and measurements](docs/engineering/VISUAL_DIFF_BENCHMARK.md)
- [Roadmap](docs/roadmap.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation, and pull request expectations. Security reports belong in GitHub's private vulnerability reporting flow described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
