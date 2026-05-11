# Workflow Safety Policy

This document defines the workflow hardening rules for repo-owned automation in `web-quality-gatekeeper`.

## Pinning Policy

- Repo-owned workflows under `.github/workflows/` pin third-party GitHub Actions to immutable commit SHAs.
- The composite Action in `action.yml` also pins third-party actions to immutable SHAs.
- Local actions (`uses: ./`) are exempt because they resolve inside this repository.
- Consumer-facing examples may choose readability over SHA pinning when they are demonstrating how to consume `Jahrome907/web-quality-gatekeeper@v3`, but repo-owned automation should stay pinned.

## Release Tag Policy

- Git tags matching stable release SemVer (`vX.Y.Z` or `vX.Y.Z+build`) may update the matching stable major tag (`vX`).
- Prerelease tags such as `vX.Y.Z-rc.1` may publish prereleases, but they must not move stable major tags.
- Major-tag movement is an explicit release-side effect and should remain gated by a stable-tag eligibility check.
- The separately triggered npm publish path must verify that the release tag
  matches `package.json` before publishing.

## PR Comment Policy

- PR summary comments are best-effort and must not be a required success condition for the quality gate itself.
- Fork PRs are treated as comment-ineligible because GitHub provides read-only tokens there.
- Same-repo PRs may attempt commenting, but permission failures should degrade to notices rather than failing the workflow.

## Token And Permission Assumptions

- Read-only repository access is the default posture for validation steps whenever possible.
- Commenting paths require issue or pull-request write permissions and only run on pull request events.
- Sensitive or authenticated audits should default to non-public artifact behavior unless explicitly overridden.
- Checkout steps should disable credential persistence when a workflow only needs
  read access.

## Setup Invariants

These invariants should remain aligned across repo-owned workflows unless a workflow documents why it differs:

- Node version: `20`
- Dependency install command: `npm ci --ignore-scripts`
- Playwright browser install when browser-based checks are required:
  `npx playwright install --with-deps chromium` on Linux and
  `npx playwright install chromium` on macOS/Windows
- Validation gate for release-sensitive flows includes `npm run check`, `npm run security:audit`, and `npm run build`

## Maintenance Expectations

- When updating a pinned GitHub Action, bump both the SHA and the human-readable version comment in the same change.
- Workflow safety rules should be backed by automated checks where practical so regressions fail quickly in CI.
