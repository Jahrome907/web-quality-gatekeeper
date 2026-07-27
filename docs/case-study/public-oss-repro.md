# Public Case Study Evidence Protocol

Use this protocol when publishing a before-and-after Web Quality Gatekeeper case study. Its purpose is to make claims independently reproducible, not to prescribe which project to audit.

## Required inputs

Record these values before running either audit:

- canonical repository URL
- baseline commit SHA
- improved commit SHA
- exact WQG config path and contents
- build and preview commands for the audited project

Use the same target, config, browser/runtime assumptions, and output settings for both commits. If an input must change, disclose the difference instead of presenting the results as a direct comparison.

## Produce the evidence

1. Check out the baseline commit and write its audit output to `artifacts/case-study/baseline`.
2. Check out the improved commit and write its audit output to `artifacts/case-study/improved`.
3. Compute deltas from the two `summary.v2.json` files:

```bash
node scripts/case-study/roi-from-summaries.mjs \
  artifacts/case-study/baseline/summary.v2.json \
  artifacts/case-study/improved/summary.v2.json \
  > artifacts/case-study/roi.json
```

4. Run `npm run case-study:provenance -- --help` for the manifest writer's current arguments, then record the repository URL, both SHAs, config, summaries, reports, review artifacts, screenshots, and ROI output in `provenance.json`.

## Publish

A complete comparison contains:

- both `summary.v2.json` files and HTML reports
- both action plans and PR Risk Ledger JSON/Markdown files
- screenshot and visual-diff evidence used by the claims
- `roi.json` and `provenance.json`
- the exact build, preview, and audit commands

Report accessibility violation deltas, average performance score and LCP deltas, visual failures, failed-page counts, and overall status. Preserve unavailable values as `null`; never substitute zero or omit a metric because it weakens the result.

Before publishing, reproduce the commands from a clean checkout and confirm every claim can be traced to the committed artifact set. Do not publish credentials, private URLs, local filesystem paths, or authenticated page content.
