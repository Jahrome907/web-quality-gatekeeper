# Web Quality Gatekeeper

[![Quality Gate](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml)
[![Pack Smoke](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/npm-pack-smoke.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/npm-pack-smoke.yml)
[![Action Smoke](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/action-smoke.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/action-smoke.yml)
[![Source Version 3.2.2](https://img.shields.io/badge/source-3.2.2-17355c?logo=git&logoColor=white)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-17693b.svg)](LICENSE)
[![Node.js 22.19+](https://img.shields.io/badge/Node.js-22.19%2B-215732?logo=node.js&logoColor=white)](https://nodejs.org/)

A quality gate CLI and GitHub Action that runs Playwright smoke checks, axe accessibility scans, Lighthouse performance audits, and visual regression diffs. It produces an HTML report plus machine-readable JSON summaries for local review and GitHub-based workflows.

Release source of truth: use GitHub tags and Releases for published versions. The `package.json` version on `main` may move ahead during release preparation.

Distribution status: tagged releases create GitHub Releases and update the stable GitHub Action major tag from the same validated source. npm publication is handled separately and is not yet part of the automated release path; until an npm release exists, use the GitHub Action or a source checkout.

<p align="center">
  <img src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/how-it-works.svg" alt="Web Quality Gatekeeper flow: target URL and config pass through policy checks into Playwright, axe, Lighthouse, and visual diff, then emit HTML reports, JSON summaries, baselines, and CI-safe outputs." width="980" />
</p>

The diagram follows the same three-step audit path described below: validate and pin the target, collect evidence once against the resolved host, then emit stable outputs for people and CI.

## Supported Usage

Use one of these public entry points:

- GitHub Action in your own repository for CI-first adoption.
- Source checkout when you want to contribute to this repository.

```bash
git clone https://github.com/Jahrome907/web-quality-gatekeeper.git
cd web-quality-gatekeeper
npm run engines:check
npm ci
npx playwright install chromium
npm run build
node dist/cli.js audit https://your-site.example --policy marketing
```

> The CLI writes `artifacts/report.html`, `artifacts/summary.json`, `artifacts/summary.v2.json`, `artifacts/action-plan.md`, and PR Risk Ledger artifacts by default.

<p align="center">
  <img src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/report-screenshot.png" alt="Web Quality Gatekeeper HTML report" width="720" />
</p>

<p align="center">
  Proof sample: inspect the published <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-report.html">fixture report</a>,
  <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-summary.v2.json">summary.v2.json</a>,
  <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-pr-risk-ledger.json">PR Risk Ledger</a>, and
  <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-proof-config.json">proof config</a>.
  The proof bundle is checked into <code>docs/proof/</code> and refreshed alongside published evidence changes.
</p>

If you prefer the repository source view, the same proof artifacts are also available as GitHub blob files:
[report.html](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/proof/fixture-report.html),
[summary.v2.json](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/proof/fixture-summary.v2.json),
[PR Risk Ledger](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/proof/fixture-pr-risk-ledger.json), and
[fixture-proof-config.json](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/proof/fixture-proof-config.json).

## Table of Contents

- [Supported Usage](#supported-usage)
- [How It Works](#how-it-works)
- [Proof & Reproducibility](#proof--reproducibility)
- [Architecture & References](#architecture--references)
- [Features](#features)
- [Consumer Usage](#consumer-usage)
- [CLI Usage](#cli-usage)
- [Baseline Workflow](#baseline-workflow)
- [Configuration](#config)
- [CI Integration](#ci-github-action)
- [Output](#output)
- [FAQ / Gotchas](#faq--gotchas)
- [Repo Development](#repo-development)
- [Tech Stack](#tech-stack)
- [License](#license)

## How It Works

1. **Validate and pin targets**: the runner normalizes each requested URL, applies SSRF-sensitive guardrails when needed, and pins audited hosts so redirect handling stays deterministic.
2. **Collect page evidence**: Playwright loads each audited target, captures runtime signals, and writes target-local screenshots. Axe, Lighthouse, and visual diff run against the resolved audit target.
3. **Emit stable outputs for people and CI**: every run writes `report.html`, `summary.json`, `summary.v2.json`, `action-plan.md`, and PR Risk Ledger artifacts, with per-page artifacts, optional baselines, and trend artifacts for longer-lived quality programs.

## Proof & Reproducibility

- Open the published sample [report.html](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-report.html), [summary.v2.json](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-summary.v2.json), and [PR Risk Ledger](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-pr-risk-ledger.json).
- Review the exact [proof config](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-proof-config.json) used for the published fixture run.
- Reproduce the local fixture walkthrough from [docs/case-study-run.md](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study-run.md).
- See the public OSS evidence protocol in [docs/case-study/public-oss-repro.md](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study/public-oss-repro.md).

## Architecture & References

- Start with the maintainer-facing [Architecture Map](docs/engineering/ARCHITECTURE_MAP.md) to see where CLI, runner, reporting, and release changes belong.
- Use the [Testing Matrix](docs/testing-matrix.md) to map a behavior change to the narrowest validation layer that should fail.
- Review [SECURITY.md](SECURITY.md) before changing target resolution, authenticated audits, or CI publication behavior.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the maintainer and contributor command set that mirrors repo automation.
- The PR Risk Ledger machine-readable contract is documented in [docs/contracts/pr-risk-ledger-v1-contract.md](docs/contracts/pr-risk-ledger-v1-contract.md).
- Review [Roadmap](docs/roadmap.md), [Provenance](docs/provenance.md), and [SBOM](docs/sbom.md) notes for public trust and release-evidence direction.
- The optional native path is a source-checkout feature documented in [native/wqg-visual-diff-native/README.md](native/wqg-visual-diff-native/README.md), with benchmarks in [benchmarks/visual-diff-benchmark.mjs](benchmarks/visual-diff-benchmark.mjs).

## Features

- **Playwright Smoke Runner:** Deterministic screenshots with configurable viewports
- **axe-core Accessibility:** WCAG compliance scanning with severity counts
- **Lighthouse Performance:** Budget enforcement for score, LCP, CLS, and TBT
- **Visual Regression:** Baseline management with pixel-level diff detection
- **Optional Native Visual Engine:** Opt-in Rust-backed diff execution with automatic fallback to `pixelmatch`
- **PR Risk Ledger:** Merge-review JSON and Markdown artifacts that summarize page, runtime, trend, and remediation risk
- **Doctor Diagnostics:** Local setup checks for Node.js, config validity, safe output paths, and browser availability
- **Actionable Remediation:** Prioritized fix guidance per failure with evidence and verification steps
- **Trend Dashboard:** Rolling history insights from prior snapshots (`trends/dashboard.html`)
- **Policy Templates:** Built-in multi-page/site templates (`marketing`, `docs`, `ecommerce`, `saas`)
- **HTML & JSON Reports:** Human-readable reports plus machine-readable summaries
- **GitHub Action + Workflow Template:** Composite Action for consumer repos, plus this repo's hardened CI workflow

## Consumer Usage

### GitHub Action in your repository

This is the supported consumer path when you want CI gating without maintaining a fork of this project.

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
        uses: Jahrome907/web-quality-gatekeeper@v3
        with:
          url: https://your-site.example
          baseline-dir: .github/web-quality/baselines
      - name: Upload artifacts
        if: always() && (env.WQG_SENSITIVE_AUDIT != 'true' || env.WQG_ALLOW_SENSITIVE_OUTPUTS == 'true')
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: wqg-artifacts
          path: |
            ${{ steps.wqg.outputs.summary-path }}
            ${{ steps.wqg.outputs.summary-v2-path }}
            ${{ steps.wqg.outputs.report-path }}
            ${{ steps.wqg.outputs.action-plan-path }}
            ${{ steps.wqg.outputs.pr-risk-ledger-path }}
            ${{ steps.wqg.outputs.pr-risk-ledger-md-path }}
          if-no-files-found: warn
```

### Local CLI from source checkout

Use this path when you want to inspect outputs locally before wiring CI or when contributing to this repository. The npm package publication path is separate from the automated GitHub Release path.

```bash
git clone https://github.com/Jahrome907/web-quality-gatekeeper.git
cd web-quality-gatekeeper
npm run engines:check
npm ci
npx playwright install chromium
npm run build
node dist/cli.js audit https://your-site.example --policy marketing
```

Open `artifacts/report.html` for the HTML report and `artifacts/summary.json` / `artifacts/summary.v2.json` for summary data.

## CLI Usage

The examples in this section use the installed binary name, `wqg`. From a
source checkout, build first and substitute `node dist/cli.js` for `wqg`.

```bash
wqg audit [url] [options]
```

The positional URL is optional when your config supplies `urls`.

Initialize a consumer repository:

```bash
wqg init --profile marketing --url https://your-site.example
```

The init command writes `.github/web-quality/config.json`, `.github/workflows/web-quality.yml`, `.github/web-quality/baselines/.gitkeep`, and `.github/web-quality/README.md` with profile-specific coverage, baseline guidance, and a report artifact upload step. It refuses to overwrite existing scaffold files unless `--force` is provided.

Check a local setup before running a heavier audit:

```bash
wqg doctor --config .github/web-quality/config.json --out artifacts --baseline-dir .github/web-quality/baselines
```

Use `wqg doctor --json` when you want machine-readable diagnostics for local setup scripts, and `wqg doctor --strict` when warnings should fail a CI/bootstrap preflight.

Common options:

```bash
wqg audit https://example.com \
  --policy marketing \
  --config .github/web-quality/config.json \
  --out artifacts \
  --baseline-dir .github/web-quality/baselines
```

Flags:

- `--set-baseline` overwrites baseline images
- `--policy <name|path>` overlays a built-in policy or policy JSON
- `--list-policies` prints built-in policy names and exits
- `--allow-internal-targets` allows internal/private targets during CI or authenticated audits
- `--no-fail-on-a11y` disables a11y failure gate
- `--no-fail-on-perf` disables performance budget gate
- `--no-fail-on-visual` disables visual diff gate
- `--format <json|json-v2|html|md|pr-risk-ledger|action-plan>` controls stdout mode (default: `html`)
- `--header "Name: Value"` adds a request header (repeatable)
- `--cookie "name=value"` adds a cookie (repeatable)
- `--verbose` for debug logging

Built-in policies are host-agnostic defaults (paths, budgets, toggles); the target host still comes from the positional audit URL unless your config explicitly sets `urls`.

### Output Formats

On successful runs, `wqg audit` writes artifact files to `--out` (default: `artifacts`) regardless of output mode:

- `summary.json`
- `summary.v2.json`
- `report.html`
- `action-plan.md`
- `pr-risk-ledger.json`
- `pr-risk-ledger.md`

`pr-risk-ledger.json` is a stable merge-review artifact. Validate it with
[`schemas/pr-risk-ledger.v1.json`](schemas/pr-risk-ledger.v1.json) when wiring
custom PR comments or dashboards.
Installed-package consumers can resolve the same schema with
`require.resolve("web-quality-gatekeeper/schemas/pr-risk-ledger.v1.json")`.

`--format` only changes the primary stdout payload:

- `--format html` (default): in standard non-verbose usage, prints no report payload to stdout and writes `report.html` plus JSON summaries.
- `--format json`: prints the v1-compatible `summary.json` payload to stdout, still writes `report.html` and summary artifacts.
- `--format json-v2`: prints the aggregate `summary.v2.json` payload to stdout for multipage-aware automation.
- `--format md`: prints a Markdown report to stdout, still writes `report.html` and summary artifacts.
- `--format pr-risk-ledger`: prints the stable PR risk ledger JSON payload to stdout.
- `--format action-plan`: prints the remediation action plan Markdown payload to stdout.

Examples:

```bash
# Default (same as --format html): artifact-driven output, no stdout payload
wqg audit https://example.com --out artifacts

# JSON to stdout for scripting while still writing report artifacts
wqg audit https://example.com --format json --out artifacts > summary.stdout.json

# Markdown to stdout for terminal/PR paste while still writing report artifacts
wqg audit https://example.com --format md --out artifacts > report.stdout.md

# Multipage-aware JSON to stdout for automation
wqg audit https://example.com --format json-v2 --out artifacts > summary.v2.stdout.json
```

## Baseline Workflow

1. Run once to create baselines:

```bash
node dist/cli.js audit https://example.com --set-baseline --baseline-dir .github/web-quality/baselines
```

1. Commit `.github/web-quality/baselines/` to track visual regression.

## Config

For a consuming repository, keep configuration in a path you own such as `.github/web-quality/config.json`. Start with a built-in policy when possible, then layer in only the settings your site actually needs.

```json
{
  "timeouts": {
    "navigationMs": 30000,
    "actionMs": 10000,
    "waitAfterLoadMs": 1000
  },
  "playwright": {
    "viewport": { "width": 1280, "height": 720 },
    "userAgent": "wqg/3.2.2",
    "locale": "en-US",
    "colorScheme": "light"
  },
  "urls": [
    { "name": "home", "url": "https://your-site.example/" },
    { "name": "pricing", "url": "https://your-site.example/pricing" }
  ],
  "screenshots": [{ "name": "page", "path": "@target", "fullPage": true }],
  "screenshotGallery": {
    "enabled": false,
    "maxScreenshotsPerPath": 12
  },
  "lighthouse": {
    "budgets": { "performance": 0.8, "lcpMs": 2500, "cls": 0.1, "tbtMs": 200 },
    "formFactor": "desktop"
  },
  "visual": {
    "threshold": 0.01,
    "engine": "pixelmatch"
  },
  "toggles": { "a11y": true, "perf": true, "visual": true }
}
```

Screenshot paths must be `@target` or target-relative paths that start with a
single `/`. Protocol-relative paths such as `//example.com/path` are rejected so
screenshots stay on the audited target.

The repository's maintainer default lives in `configs/default.json`, but that path is repo-internal and not the recommended public example for consumers.

To opt into the native visual diff engine from a source checkout, point the config at a compiled binary and keep the TypeScript path as fallback:

```json
{
  "visual": {
    "threshold": 0.01,
    "engine": "native-rust",
    "nativeBinaryPath": "native/wqg-visual-diff-native/target/release/wqg-visual-diff-native",
    "pixelmatch": {
      "includeAA": true
    }
  }
}
```

The same path can also be toggled ad hoc with `WQG_VISUAL_DIFF_ENGINE=native-rust` and `WQG_VISUAL_DIFF_NATIVE_BIN=/path/to/binary`.

In CI, native execution is disabled unless `WQG_ALLOW_NATIVE_VISUAL_ENGINE=true`
is set. Without that explicit opt-in, audits fall back to `pixelmatch`.
Native execution also falls back unless `visual.pixelmatch.includeAA=true` is
set, because anti-aliased pixel suppression remains owned by the TypeScript
reference path.

The npm package does not ship the Rust crate or prebuilt native binaries. Package consumers should use the default `pixelmatch` engine unless they provide their own reviewed native binary path.

## CI (GitHub Action)

This repo includes:

- A composite Action (`action.yml`) you can call from your own workflows.
- A hardened workflow (`.github/workflows/quality-gate.yml`) used by this repository.

For most consumers, the composite Action is the supported starting point.

The composite Action exposes stable artifact path outputs for downstream
workflow steps: `status`, `summary-path`, `summary-v2-path`, `report-path`,
`action-plan-path`, `pr-risk-ledger-path`, and `pr-risk-ledger-md-path`.

Workflow behavior (`.github/workflows/quality-gate.yml`):

- `WQG_URL` overrides the default target and runs a remote audit.
- Otherwise the repo keeps CI hermetic by auditing a local docs preview when `docs/index.html` exists.
- Repos without a docs preview fall back to a local `demo` script when present, then to a remote Pages URL or `https://example.com`.
- Local docs-preview and demo runs stay blocking and pass `--allow-internal-targets` for the loopback target.
- Set `WQG_RELAXED_REMOTE=true` to make remote mode non-blocking (`--no-fail-on-a11y --no-fail-on-perf --no-fail-on-visual`).
- If authenticated inputs are detected (`WQG_AUTH_HEADER(S)` / `WQG_AUTH_COOKIE(S)`) or `WQG_SENSITIVE_AUDIT=true`, artifact upload and PR comments are disabled by default.
- Set `WQG_ALLOW_SENSITIVE_OUTPUTS=true` only when you intentionally want to publish outputs for a sensitive run.
- Internal/private targets are blocked by default in CI and authenticated runs unless you explicitly set `--allow-internal-targets` or `WQG_ALLOW_INTERNAL_TARGETS=true`.
- Requested public targets are DNS-resolved and pinned before Playwright/Lighthouse execution where browser resolver rules are supported. Sensitive-mode redirect destinations and outbound HTTP(S) request targets are verified before continuation and blocked when they resolve to private network space.

## Output

Artifacts written to the output directory:

- `summary.json`
- `summary.v2.json`
- `report.html`
- `action-plan.md`
- `pr-risk-ledger.json` and `pr-risk-ledger.md`
- `screenshots/*.png`
- `diffs/*.png` (when baselines exist)
- `axe.json`
- `lighthouse.json`
- `pages/*` (multi-target audits)
- `trends/history.json` and `trends/dashboard.html` (when `trends.enabled` is true)

Example summary snippet:

```json
{
  "overallStatus": "pass",
  "steps": { "a11y": "pass", "perf": "pass", "visual": "pass" },
  "performance": { "metrics": { "performanceScore": 0.92, "lcpMs": 1800 } }
}
```

## Repo Development

These commands are for maintainers and contributors working in this repository itself. Consumers using the Action do not need the full repo validation stack.

```bash
npm run engines:check
npm ci
npx playwright install chromium
npm run validate:full
npm run check
npm run contracts:check
npm run security:audit
npm run python:smoke
npm run smoke:pack
npm run smoke:action
npm run release:dry-run
npm run audit -- https://example.com
```

`npm run smoke:action` is strict by default. Use `WQG_ACTION_SMOKE_ALLOW_SKIP=true` only for optional local probing on machines without a Bash-side Playwright browser.

Optional Python bundle analytics live in [tools/python/README.md](tools/python/README.md), are covered by `npm run python:smoke`, and are intentionally outside the core CLI path.

Maintainer references:

- [Architecture Map](docs/engineering/ARCHITECTURE_MAP.md)
- [Testing Matrix](docs/testing-matrix.md)
- [Workflow Safety Policy](docs/engineering/WORKFLOW_SAFETY_POLICY.md)

## Tech Stack

| Technology                                                  | Purpose                            |
| ----------------------------------------------------------- | ---------------------------------- |
| [Playwright](https://playwright.dev/)                       | Browser automation & screenshots   |
| [axe-core](https://github.com/dequelabs/axe-core)           | Accessibility testing              |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Performance auditing               |
| [pixelmatch](https://github.com/mapbox/pixelmatch)          | Visual diff comparison             |
| [Rust](https://www.rust-lang.org/)                          | Optional native visual diff engine |
| [Zod](https://zod.dev/)                                     | Configuration validation           |
| [Commander](https://github.com/tj/commander.js)             | CLI framework                      |

## FAQ / Gotchas

<details>
<summary><strong>What Node.js version do I need?</strong></summary>

Node **22.19 or later** is required (`engines.node` is set to `>=22.19`). Repo-owned release and publish workflows run on Node 24, and package smoke coverage also runs on Node 22.19 to protect the advertised minimum runtime.

</details>

<details>
<summary><strong>Why is the first run so slow?</strong></summary>

`npx playwright install chromium` downloads the Chromium browser used by the runners. On Linux CI, use `npx playwright install --with-deps chromium` when system packages are not already present.

</details>

<details>
<summary><strong>What should I commit from the baselines workflow?</strong></summary>

- **Commit:** `baselines/*.png`. These are reference screenshots for visual regression.
- **Do not commit:** `artifacts/`. Generated every run. Add it to `.gitignore`.

</details>

<details>
<summary><strong>How long does a full audit take in CI?</strong></summary>

Roughly **30 to 90 seconds** depending on page count, page complexity, Lighthouse throttling, and runner specs. The GitHub-hosted `ubuntu-latest` runners typically finish in under a minute for a basic audit.

</details>

<details>
<summary><strong>Can I audit multiple pages?</strong></summary>

Yes. Add `urls` entries for each audited page. Use `screenshots[].path: "@target"` when each page should capture the audited URL instead of a fixed path such as `/`.

</details>

<details>
<summary><strong>Can I use the Rust visual diff path in normal audits?</strong></summary>

Yes, from a source checkout or with your own reviewed native binary. Build the crate in `native/wqg-visual-diff-native/`, then set `visual.engine` to `native-rust` and `visual.nativeBinaryPath` in config, or provide the equivalent `WQG_VISUAL_DIFF_*` environment variables. JavaScript adapter paths are refused unless `WQG_ALLOW_SCRIPT_NATIVE_ENGINE=true` is set for trusted test adapters; shell, batch, PowerShell, and shebang script adapters are always refused. Unsupported settings, missing binaries, health-probe failures, runtime failures, or CI runs without `WQG_ALLOW_NATIVE_VISUAL_ENGINE=true` fall back to `pixelmatch` automatically.

</details>

## Author

**Jahrome:** [GitHub](https://github.com/Jahrome907)

## License

MIT. See [LICENSE](LICENSE) for details.
