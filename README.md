# Web Quality Gatekeeper

[![Quality Gate](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml)
[![Pack Smoke](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/npm-pack-smoke.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/npm-pack-smoke.yml)
[![Action Smoke](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/action-smoke.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/action-smoke.yml)
[![Source Version 3.1.4](https://img.shields.io/badge/source-3.1.4-17355c?logo=git&logoColor=white)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-17693b.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-215732?logo=node.js&logoColor=white)](https://nodejs.org/)

A quality gate CLI and GitHub Action that runs Playwright smoke checks, axe accessibility scans, Lighthouse performance audits, and visual regression diffs. It produces an HTML report plus machine-readable JSON summaries for local review and GitHub-based workflows.

Release source of truth: use GitHub tags and Releases for published versions. The `package.json` version on `main` may move ahead during release preparation.

Distribution status: tagged releases create GitHub Releases and update the stable GitHub Action major tag from the same validated source. npm publication is deferred to the manual maintainer backfill workflow; until an npm release exists, use the GitHub Action or a source checkout.

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
npm ci
npx playwright install
npm run build
node dist/cli.js audit https://your-site.example --policy marketing
```

> The CLI writes `artifacts/report.html`, `artifacts/summary.json`, and `artifacts/summary.v2.json` by default.

<p align="center">
  <img src="https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/main/assets/report-screenshot.png" alt="Web Quality Gatekeeper HTML report" width="720" />
</p>

<p align="center">
  Proof sample: inspect the published <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-report.html">fixture report</a>,
  <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-summary.v2.json">summary.v2.json</a>, and
  <a href="https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-proof-config.json">proof config</a>.
  The proof bundle is checked into <code>docs/proof/</code> and refreshed alongside published evidence changes.
</p>

If you prefer the repository source view, the same proof artifacts are also available as GitHub blob files:
[report.html](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/proof/fixture-report.html),
[summary.v2.json](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/proof/fixture-summary.v2.json), and
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

1. **Validate and pin the target**: the runner normalizes the requested URL, applies SSRF-sensitive guardrails when needed, and pins the audited host so redirect handling stays deterministic.
2. **Collect evidence on one audited target**: Playwright loads the page, captures runtime signals and screenshots, then axe, Lighthouse, and visual diff run against the same resolved target.
3. **Emit stable outputs for people and CI**: every run writes `report.html`, `summary.json`, and `summary.v2.json`, with optional baselines and trend artifacts for longer-lived quality programs.

## Proof & Reproducibility

- Open the published sample [report.html](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-report.html) and [summary.v2.json](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-summary.v2.json).
- Review the exact [proof config](https://jahrome907.github.io/web-quality-gatekeeper/proof/fixture-proof-config.json) used for the published fixture run.
- Reproduce the local fixture walkthrough from [docs/case-study-run.md](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study-run.md).
- See the public OSS evidence protocol in [docs/case-study/public-oss-repro.md](https://github.com/Jahrome907/web-quality-gatekeeper/blob/main/docs/case-study/public-oss-repro.md).

## Architecture & References

- Start with the maintainer-facing [Architecture Map](docs/engineering/ARCHITECTURE_MAP.md) to see where CLI, runner, reporting, and release changes belong.
- Use the [Testing Matrix](docs/testing-matrix.md) to map a behavior change to the narrowest validation layer that should fail.
- Review [SECURITY.md](SECURITY.md) before changing target resolution, authenticated audits, or CI publication behavior.
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the maintainer and contributor command set that mirrors repo automation.
- The optional native path is documented in [native/wqg-visual-diff-native-spike/README.md](native/wqg-visual-diff-native-spike/README.md), with benchmarks in [benchmarks/visual-diff-benchmark.mjs](benchmarks/visual-diff-benchmark.mjs).

## Features

- **Playwright Smoke Runner** — Deterministic screenshots with configurable viewports
- **axe-core Accessibility** — WCAG compliance scanning with severity counts
- **Lighthouse Performance** — Budget enforcement for score, LCP, CLS, and TBT
- **Visual Regression** — Baseline management with pixel-level diff detection
- **Optional Native Visual Engine** — Opt-in Rust-backed diff execution with automatic fallback to `pixelmatch`
- **Actionable Remediation** — Prioritized fix guidance per failure with evidence and verification steps
- **Trend Dashboard** — Rolling history insights from prior snapshots (`trends/dashboard.html`)
- **Policy Templates** — Built-in multi-page/site templates (`marketing`, `docs`, `ecommerce`, `saas`)
- **HTML & JSON Reports** — Human-readable reports plus machine-readable summaries
- **GitHub Action + Workflow Template** — Composite Action for consumer repos, plus this repo's hardened CI workflow

## Consumer Usage

### GitHub Action in your repository

This is the supported consumer path when you want CI gating without maintaining a fork of this project.

```yaml
jobs:
  web-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          persist-credentials: false
      - uses: Jahrome907/web-quality-gatekeeper@v3
        with:
          url: https://your-site.example
          baseline-dir: .github/web-quality/baselines
```

### Local CLI from source checkout

Use this path when you want to inspect outputs locally before wiring CI or when contributing to this repository. The npm package publication path is deferred until a maintainer backfill release is cut.

```bash
git clone https://github.com/Jahrome907/web-quality-gatekeeper.git
cd web-quality-gatekeeper
npm ci
npx playwright install
npm run build
node dist/cli.js audit https://your-site.example --policy marketing
```

Open `artifacts/report.html` for the HTML report and `artifacts/summary.json` / `artifacts/summary.v2.json` for summary data.

## CLI Usage

```bash
wqg audit <url> [options]
```

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
- `--format <json|html|md>` controls stdout mode (default: `html`)
- `--header "Name: Value"` adds a request header (repeatable)
- `--cookie "name=value"` adds a cookie (repeatable)
- `--verbose` for debug logging

Built-in policies are host-agnostic defaults (paths, budgets, toggles); the target host still comes from `wqg audit <url>` unless your config explicitly sets `urls`.

### Output Formats

On successful runs, `wqg audit` writes artifact files to `--out` (default: `artifacts`) regardless of output mode:

- `summary.json`
- `summary.v2.json`
- `report.html`

`--format` only changes the primary stdout payload:

- `--format html` (default): in standard non-verbose usage, prints no report payload to stdout and writes `report.html` plus JSON summaries.
- `--format json`: prints `summary.json` payload to stdout, still writes `report.html` and summary artifacts.
- `--format md`: prints a Markdown report to stdout, still writes `report.html` and summary artifacts.

Examples:

```bash
# Default (same as --format html): artifact-driven output, no stdout payload
wqg audit https://example.com --out artifacts

# JSON to stdout for scripting while still writing report artifacts
wqg audit https://example.com --format json --out artifacts > summary.stdout.json

# Markdown to stdout for terminal/PR paste while still writing report artifacts
wqg audit https://example.com --format md --out artifacts > report.stdout.md
```

## Baseline Workflow

1. Run once to create baselines:

```bash
npx wqg audit https://example.com --set-baseline --baseline-dir .github/web-quality/baselines
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
    "userAgent": "wqg/3.1.4",
    "locale": "en-US",
    "colorScheme": "light"
  },
  "screenshots": [{ "name": "home", "path": "/", "fullPage": true }],
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

The repository's maintainer default lives in `configs/default.json`, but that path is repo-internal and not the recommended public example for consumers.

To opt into the native visual diff engine, point the config at a compiled binary and keep the TypeScript path as fallback:

```json
{
  "visual": {
    "threshold": 0.01,
    "engine": "native-rust-spike",
    "nativeBinaryPath": "native/wqg-visual-diff-native-spike/target/release/wqg-visual-diff-native-spike"
  }
}
```

The same seam can also be toggled ad hoc with `WQG_VISUAL_DIFF_ENGINE=native-rust-spike` and `WQG_VISUAL_DIFF_NATIVE_BIN=/path/to/binary`.

## CI (GitHub Action)

This repo includes:

- A composite Action (`action.yml`) you can call from your own workflows.
- A hardened workflow (`.github/workflows/quality-gate.yml`) used by this repository.

For most consumers, the composite Action is the supported starting point.

Workflow behavior (`.github/workflows/quality-gate.yml`):

- `WQG_URL` overrides the default target and runs a remote audit.
- Otherwise the repo keeps CI hermetic by auditing a local docs preview when `docs/index.html` exists.
- Repos without a docs preview fall back to a local `demo` script when present, then to a remote Pages URL or `https://example.com`.
- Local docs-preview and demo runs stay blocking and pass `--allow-internal-targets` for the loopback target.
- Set `WQG_RELAXED_REMOTE=true` to make remote mode non-blocking (`--no-fail-on-a11y --no-fail-on-perf --no-fail-on-visual`).
- If authenticated inputs are detected (`WQG_AUTH_HEADER(S)` / `WQG_AUTH_COOKIE(S)`) or `WQG_SENSITIVE_AUDIT=true`, artifact upload and PR comments are disabled by default.
- Set `WQG_ALLOW_SENSITIVE_OUTPUTS=true` only when you intentionally want to publish outputs for a sensitive run.
- Internal/private targets are blocked by default in CI and authenticated runs unless you explicitly set `--allow-internal-targets` or `WQG_ALLOW_INTERNAL_TARGETS=true`.
- Public targets are DNS-resolved and pinned before Playwright/Lighthouse execution so redirect chains and follow-on requests cannot silently pivot into private network space during sensitive runs.

## Output

Artifacts written to the output directory:

- `summary.json`
- `summary.v2.json`
- `report.html`
- `action-plan.md`
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
npm ci
npx playwright install
npm run check
npm run contracts:check
npm run security:audit
npm run smoke:pack
npm run smoke:action
npm run build
npm run audit -- https://example.com
```

Optional Python bundle analytics live in [tools/python/README.md](tools/python/README.md) and are intentionally outside the core CLI path.

Maintainer references:

- [Architecture Map](docs/engineering/ARCHITECTURE_MAP.md)
- [Testing Matrix](docs/testing-matrix.md)
- [Workflow Safety Policy](docs/engineering/WORKFLOW_SAFETY_POLICY.md)

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Playwright](https://playwright.dev/) | Browser automation & screenshots |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility testing |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Performance auditing |
| [pixelmatch](https://github.com/mapbox/pixelmatch) | Visual diff comparison |
| [Rust](https://www.rust-lang.org/) | Optional native visual diff engine |
| [Zod](https://zod.dev/) | Configuration validation |
| [Commander](https://github.com/tj/commander.js) | CLI framework |

## FAQ / Gotchas

<details>
<summary><strong>What Node.js version do I need?</strong></summary>

Node **20 or later** is required (`engines.node` is set to `>=20`). Earlier versions are not tested and may fail.
</details>

<details>
<summary><strong>Why is the first run so slow?</strong></summary>

`npx playwright install` downloads Chromium (and optionally Firefox/WebKit) browsers. This is a one-time cost (~250 MB). In CI, cache `~/.cache/ms-playwright` to skip repeated downloads.
</details>

<details>
<summary><strong>What should I commit from the baselines workflow?</strong></summary>

- **Commit:** `baselines/*.png` — these are reference screenshots for visual regression.
- **Do not commit:** `artifacts/` — generated every run. Add it to `.gitignore`.

</details>

<details>
<summary><strong>How long does a full audit take in CI?</strong></summary>

Roughly **30–90 seconds** depending on page complexity, Lighthouse throttling, and runner specs. The GitHub-hosted `ubuntu-latest` runners typically finish in under a minute for a single-page audit.
</details>

<details>
<summary><strong>Can I audit multiple pages?</strong></summary>

Yes — add entries to the `screenshots` array in your config. Each entry gets its own screenshot, axe scan, and visual diff.
</details>

<details>
<summary><strong>Can I use the Rust visual diff path in normal audits?</strong></summary>

Yes. Build the crate in `native/wqg-visual-diff-native-spike/`, then set `visual.engine` to `native-rust-spike` and `visual.nativeBinaryPath` in config, or provide the equivalent `WQG_VISUAL_DIFF_*` environment variables. Unsupported settings, missing binaries, or runtime failures fall back to `pixelmatch` automatically.
</details>

## Author

**Jahrome** — [GitHub](https://github.com/Jahrome907)

## License

MIT — see [LICENSE](LICENSE) for details.
