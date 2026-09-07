# Python Tooling

This directory contains optional Python helpers for artifact post-processing and case-study
analytics. The core `wqg audit` CLI and GitHub Action do not require Python.

## Environment

- Python version: `3.11+`
- Dependencies: Python standard library only
- Isolation: tooling lives entirely under `tools/python/`

## Smoke Check

```bash
npm run python:smoke
```

## Case Study Bundle Analytics

`case_study_analytics.py` reads one or more WQG case-study bundle directories and produces
normalized JSON, CSV, and optional Markdown output.

Expected bundle contents:

- `summary.v2.json`, `fixture-summary.v2.json`, or `artifacts/summary.v2.json`
- optional `provenance.json` or `fixture-provenance.json`
- optional `roi.json`

Example:

```bash
python tools/python/case_study_analytics.py \
  --bundle docs/proof \
  --json-out .tmp-python/case-study.json \
  --csv-out .tmp-python/case-study.csv \
  --markdown-out .tmp-python/case-study.md
```

The JSON output is suitable for downstream automation, the CSV is spreadsheet-friendly, and the
Markdown output is useful for human-readable run summaries or PR notes.

## Compare two audit reports

`compare_runs.py` is an offline, standard-library-only comparison for a pair of `summary.v2.json`
reports. It accepts either one aggregate report with `pages`, or a detail report for one target. It
does not fetch URLs or upload report contents.

Download or retain the two report files in a private workspace, then run:

```bash
python tools/python/compare_runs.py \
  --before artifacts/before/summary.v2.json \
  --after artifacts/after/summary.v2.json \
  --fail-on-regression \
  --format markdown \
  --output artifacts/comparison.md
```

The default output is JSON on standard output. Use `--format csv` for a compact page table. A
comparison exits `1` only with `--fail-on-regression` and an observed regression. It exits `2` for
invalid or incomplete coverage, including removed pages, missing previously measured metrics, or no
matching pages. Added pages are reported separately and are not treated as evidence that an existing
page improved. Timing and score deltas are diagnostic; the tool does not invent significance thresholds.
When a budget key has no prior result, a failing value is reported as a new finding, rather than
claimed as a regression. A budget regression requires that the same prior key passed.
Markdown written to standard output is UTF-8, including on Windows sessions configured with a legacy
console code page. Use `--output` when a shell or downstream tool needs a file instead.
