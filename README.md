# Web Quality Gatekeeper

[![CI](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml/badge.svg)](https://github.com/Jahrome907/web-quality-gatekeeper/actions/workflows/quality-gate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Coverage](https://img.shields.io/codecov/c/github/Jahrome907/web-quality-gatekeeper?logo=codecov)](https://codecov.io/gh/Jahrome907/web-quality-gatekeeper)

A production-ready quality gate CLI and GitHub Action that runs Playwright smoke checks, axe accessibility scans, Lighthouse performance audits, and visual regression diffs on every PR. Outputs a clean HTML report plus a machine-readable JSON summary.

![Report sample](assets/report-sample.svg)

## Table of Contents

- [Features](#features)
- [Quickstart](#quickstart)
- [CLI Usage](#cli-usage)
- [Baseline Workflow](#baseline-workflow)
- [Configuration](#config)
- [CI Integration](#ci-github-action)
- [Output](#output)
- [Development](#development)
- [Tech Stack](#tech-stack)
- [License](#license)

## Features

- **Playwright Smoke Runner** — Deterministic screenshots with configurable viewports
- **axe-core Accessibility** — WCAG compliance scanning with severity counts
- **Lighthouse Performance** — Budget enforcement for score, LCP, CLS, and TBT
- **Visual Regression** — Baseline management with pixel-level diff detection
- **HTML & JSON Reports** — Human-readable reports plus machine-readable summaries
- **GitHub Action** — Automated PR comments with results and artifact uploads

## Quickstart

```bash
npm ci
npx playwright install
npm run build
npm run audit -- https://example.com
```

Open `artifacts/report.html` for the HTML report and `artifacts/summary.json` for the summary data.

## CLI Usage

```bash
wqg audit <url> [options]
```

Common options:

```bash
wqg audit https://example.com \
  --config configs/default.json \
  --out artifacts \
  --baseline-dir baselines
```

Flags:

- `--set-baseline` overwrites baseline images
- `--no-fail-on-a11y` disables a11y failure gate
- `--no-fail-on-perf` disables performance budget gate
- `--no-fail-on-visual` disables visual diff gate
- `--verbose` for debug logging

## Baseline Workflow

1. Run once to create baselines:

```bash
npm run audit -- https://example.com --set-baseline
```

2. Commit `baselines/` to track visual regression.

## Config

Default config lives at `configs/default.json`.

```json
{
  "timeouts": {
    "navigationMs": 30000,
    "actionMs": 10000,
    "waitAfterLoadMs": 1000
  },
  "playwright": {
    "viewport": { "width": 1280, "height": 720 },
    "userAgent": "wqg/0.1.0",
    "locale": "en-US",
    "colorScheme": "light"
  },
  "screenshots": [{ "name": "home", "path": "/", "fullPage": true }],
  "lighthouse": {
    "budgets": { "performance": 0.8, "lcpMs": 2500, "cls": 0.1, "tbtMs": 200 },
    "formFactor": "desktop"
  },
  "visual": { "threshold": 0.01 },
  "toggles": { "a11y": true, "perf": true, "visual": true }
}
```

## CI (GitHub Action)

### Usage as GitHub Action

Add to your workflow:

```yaml
- uses: Jahrome907/web-quality-gatekeeper@v1
  with:
    url: https://my-site.com
```

Inputs:

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `url` | Yes | — | URL to audit |
| `config-path` | No | `configs/default.json` | Path to config JSON file |
| `baseline-dir` | No | `baselines` | Directory for visual regression baselines |
| `fail-on-a11y` | No | `true` | Fail if accessibility violations are found |
| `fail-on-perf` | No | `true` | Fail if performance budgets are exceeded |
| `fail-on-visual` | No | `true` | Fail if visual diffs exceed threshold |

### CI Workflow

The workflow runs on `pull_request`, installs dependencies, runs `npm run check`, and audits a URL.

- If a `demo` script exists in `package.json`, the Action will start it and audit `http://localhost:4173` (with a11y failures enabled).
- Otherwise, it defaults to `https://example.com` and disables a11y failure to keep the fallback green.
- You can override with `WQG_URL` in the workflow env to re-enable strict a11y gating.

Artifacts are uploaded from `artifacts/` and a concise PR comment is posted with results.

## Output

Artifacts written to the output directory:

- `summary.json`
- `report.html`
- `screenshots/*.png`
- `diffs/*.png` (when baselines exist)
- `axe.json`
- `lighthouse.json`

Example summary snippet:

```json
{
  "overallStatus": "pass",
  "steps": { "a11y": "pass", "perf": "pass", "visual": "pass" },
  "performance": { "metrics": { "performanceScore": 0.92, "lcpMs": 1800 } }
}
```

## Development

```bash
npm ci
npx playwright install
npm run check
npm run build
npm run audit -- https://example.com
```

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [Playwright](https://playwright.dev/) | Browser automation & screenshots |
| [axe-core](https://github.com/dequelabs/axe-core) | Accessibility testing |
| [Lighthouse](https://developer.chrome.com/docs/lighthouse/) | Performance auditing |
| [pixelmatch](https://github.com/mapbox/pixelmatch) | Visual diff comparison |
| [Zod](https://zod.dev/) | Configuration validation |
| [Commander](https://github.com/tj/commander.js) | CLI framework |

## Author

**Jahrome** — [GitHub](https://github.com/Jahrome907)

## License

MIT — see [LICENSE](LICENSE) for details.
