# Public OSS Reproducible Case Study Protocol

This protocol defines how to publish one public, reproducible ROI case study for Web Quality Gatekeeper.

## Selection Rule

Pick the first repository from this ordered shortlist that can be built and previewed in CI using pinned commits:

1. `vitejs/vite` docs site
2. `withastro/docs`
3. `remix-run/remix-website`

Use fixed SHAs for:

- `BASELINE_SHA`: commit before quality improvements
- `IMPROVED_SHA`: commit after quality improvements

## Reproduction Steps

1. Check out `BASELINE_SHA` and run WQG with the same config, output to `artifacts/case-study/baseline`.
2. Check out `IMPROVED_SHA` and run WQG with the same config, output to `artifacts/case-study/improved`.
3. Compute ROI deltas:

```bash
node scripts/case-study/roi-from-summaries.mjs \
  artifacts/case-study/baseline/summary.v2.json \
  artifacts/case-study/improved/summary.v2.json
```

## Required Published Metrics

- A11y: rollup violations delta.
- Performance: performance score delta and LCP delta.
- Visual: visual failures delta.
- Quality outcome: failed pages delta and overall status change.

## Evidence Bundle

Publish:

- Both `summary.v2.json` files.
- Both `report.html` files.
- ROI JSON output from the script.
- The exact run command, config path, and environment notes.
