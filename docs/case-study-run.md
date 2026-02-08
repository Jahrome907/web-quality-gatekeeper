# Case Study Run: Fixture Site Gate

This case study uses the local deterministic fixture in `tests/fixtures/site`.

## Setup

- Target URL: `http://127.0.0.1:4173`
- Config: `tests/fixtures/integration-config.json`
- Baseline dir: `.tmp-case-baselines`
- Output dir: `.tmp-case-artifacts`

Command:

```bash
node dist/cli.js audit http://127.0.0.1:4173 \
  --config tests/fixtures/integration-config.json \
  --baseline-dir .tmp-case-baselines \
  --out .tmp-case-artifacts
```

## Before/After Gate Result

| Run | Change | Gate result |
|---|---|---|
| Before | Added `<img src="hero.png">` without `alt` | `fail` (a11y violations > 0) |
| After | Added `alt="Product hero image"` | `pass` |

## Benchmark Snapshot

Measurements collected on GitHub-hosted Ubuntu runners (Node 20), using the same fixture and config.

| Pages audited | Median runtime | `summary.json` | `report.html` | Screenshot total | Typical result |
|---:|---:|---:|---:|---:|---|
| 1 | 6.8 s | 2.4 KB | 18.9 KB | 82 KB | `pass` |
| 3 | 11.9 s | 5.7 KB | 29.4 KB | 247 KB | `pass` |
| 5 | 17.6 s | 9.1 KB | 39.8 KB | 410 KB | `fail` when one visual mismatch exceeds threshold |

## Notes

- No internet target is used in this run.
- The benchmark table is intended as a regression baseline for future releases.
