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
  --baseline-action-plan artifacts/case-study/baseline/action-plan.md \
  --improved-action-plan artifacts/case-study/improved/action-plan.md \
  --baseline-pr-risk-ledger artifacts/case-study/baseline/pr-risk-ledger.json \
  --improved-pr-risk-ledger artifacts/case-study/improved/pr-risk-ledger.json \
  --baseline-pr-risk-ledger-md artifacts/case-study/baseline/pr-risk-ledger.md \
  --improved-pr-risk-ledger-md artifacts/case-study/improved/pr-risk-ledger.md \
  --roi-output artifacts/case-study/roi.json \
  --config "$CONFIG_PATH" \
  --out artifacts/case-study/provenance.json
```

## Publish

A complete comparison contains:

- both `summary.v2.json` files and HTML reports
- both action plans and PR Risk Ledger JSON/Markdown files
- screenshot and visual-diff evidence used by the claims
- `roi.json` and `provenance.json`
- the exact build, preview, and audit commands

Report accessibility violation deltas, average performance score and LCP deltas, visual failures, failed-page counts, and overall status. Preserve unavailable values as `null`; never substitute zero or omit a metric because it weakens the result.

Before publishing, reproduce the commands from a clean checkout and confirm every claim can be traced to the committed artifact set. Do not publish credentials, private URLs, local filesystem paths, or authenticated page content.
