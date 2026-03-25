# Public OSS Reproducible Case Study Protocol

This protocol defines the minimum evidence bar for publishing a public baseline/improved case
study for Web Quality Gatekeeper.

## Required Inputs

Do not publish a case study without these values:

- `REPO_URL`: canonical Git remote URL for the audited project.
- `BASELINE_SHA`: commit before the quality improvements.
- `IMPROVED_SHA`: commit after the quality improvements.
- `CONFIG_PATH`: the exact WQG config used for both runs.

These values must appear in the published evidence bundle and in the machine-readable provenance
manifest.

## Candidate Repositories

Pick the first repository from this ordered shortlist that can be built and previewed in CI using
pinned commits:

1. `vitejs/vite` docs site
2. `withastro/docs`
3. `remix-run/remix-website`

## Reproduction Steps

1. Check out `BASELINE_SHA` and run WQG with `CONFIG_PATH`, writing output to `artifacts/case-study/baseline`.
2. Check out `IMPROVED_SHA` and run WQG with the same `CONFIG_PATH`, writing output to `artifacts/case-study/improved`.
3. Compute ROI deltas:

```bash
node scripts/case-study/roi-from-summaries.mjs \
  artifacts/case-study/baseline/summary.v2.json \
  artifacts/case-study/improved/summary.v2.json \
  > artifacts/case-study/roi.json
```

4. Write the provenance manifest:

```bash
node scripts/case-study/write-provenance-manifest.mjs \
  --repo-url "$REPO_URL" \
  --baseline-sha "$BASELINE_SHA" \
  --improved-sha "$IMPROVED_SHA" \
  --baseline-summary artifacts/case-study/baseline/summary.v2.json \
  --improved-summary artifacts/case-study/improved/summary.v2.json \
  --baseline-report artifacts/case-study/baseline/report.html \
  --improved-report artifacts/case-study/improved/report.html \
  --roi-output artifacts/case-study/roi.json \
  --config "$CONFIG_PATH" \
  --out artifacts/case-study/provenance.json
```

## Required Published Metrics

- A11y: rollup violations delta.
- Performance: average performance score delta and average LCP delta across all audited pages.
- Visual: visual failures delta.
- Quality outcome: failed pages delta and overall status change.
- If a metric is unavailable in either run, publish it as unavailable/null instead of substituting `0`.

## Evidence Bundle

Publish all of the following:

- `artifacts/case-study/baseline/summary.v2.json`
- `artifacts/case-study/improved/summary.v2.json`
- `artifacts/case-study/baseline/report.html`
- `artifacts/case-study/improved/report.html`
- `artifacts/case-study/roi.json`
- `artifacts/case-study/provenance.json`
- The exact run commands if they differ from the documented protocol

## Reproducibility Checklist

- `REPO_URL`, `BASELINE_SHA`, and `IMPROVED_SHA` are recorded in the manifest.
- The same `CONFIG_PATH` was used for both runs.
- Both summary paths and both report paths resolve correctly in the manifest.
- ROI output was computed from `summary.v2.json`, not hand-entered metrics.
- Published claims match the ROI JSON and the committed artifact set.
