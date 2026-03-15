# Python Tooling

This directory contains optional Python helpers for artifact post-processing and case-study
analytics. The core `wqg audit` CLI and GitHub Action do not require Python.

## Environment

- Python version: `3.11+`
- Dependency policy: standard library only for this phase
- Isolation: tooling lives entirely under `tools/python/`

## Smoke Check

```bash
npm run python:smoke
```

## Case Study Bundle Analytics

`case_study_analytics.py` reads one or more WQG case-study bundle directories and produces
normalized JSON, CSV, and optional Markdown output.

Expected bundle contents:

- `summary.v2.json` or `artifacts/summary.v2.json`
- optional `provenance.json` or `fixture-provenance.json`
- optional `roi.json`

Example:

```bash
python3 tools/python/case_study_analytics.py \
  --bundle docs/proof \
  --json-out .tmp-python/case-study.json \
  --csv-out .tmp-python/case-study.csv \
  --markdown-out .tmp-python/case-study.md
```

The JSON output is suitable for downstream automation, the CSV is spreadsheet-friendly, and the
Markdown output is useful for human-readable run summaries or PR notes.
