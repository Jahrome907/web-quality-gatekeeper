# PR Risk Ledger v1 Contract

The PR Risk Ledger is the stable merge-review artifact written to
`pr-risk-ledger.json` on every audit run. It summarizes page, accessibility,
performance, visual, runtime, trend, and aggregate risk in a compact shape that
CI comments and downstream tooling can consume without parsing the HTML report.

Current schema version: `1.0.0`

Schema URI:
`https://raw.githubusercontent.com/Jahrome907/web-quality-gatekeeper/v3/schemas/pr-risk-ledger.v1.json`

Runtime artifact: `pr-risk-ledger.json`

Markdown companion: `pr-risk-ledger.md`

## Stability Rules

- Additive fields may be introduced in future minor releases after the schema
  version is updated.
- Existing required fields, enum values, and severity/source meanings stay
  stable for the v1 line.
- The Markdown companion is for people. Automation should consume
  `pr-risk-ledger.json` and validate it against `schemas/pr-risk-ledger.v1.json`.
- Untrusted Markdown fields are escaped before writing so page names, URLs, and
  remediation text cannot inject links or HTML into review comments.

## Verification

Run the focused ledger contract test after changing ledger output:

```bash
npx vitest run tests/prRiskLedger.test.ts
```

Run the broader contract gate before release-sensitive changes:

```bash
npm run contracts:check
```
