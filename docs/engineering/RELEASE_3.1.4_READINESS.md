# Historical Release 3.1.4 Readiness Record

Date: 2026-04-29
Branch: `release/3.1.4`

This is an archived readiness record for v3.1.4. Do not use it as the current
release checklist. For current release validation, use `CONTRIBUTING.md`,
`docs/testing-matrix.md`, and `docs/engineering/WORKFLOW_SAFETY_POLICY.md`.

Historical scope: release preparation for the v3.1.4 public patch line, GitHub
Release creation, and stable Action tag movement.

## Release Contents

- Public package version: `3.1.4`
- Public stable Action tag: `v3`
- Release tag: `v3.1.4`
- npm package: handled by the separately triggered npm publish workflow

This release includes the OSS hardening work in the release branch:

- public usage and trust-surface cleanup
- multi-target aggregate root report rendering
- trend insights in root HTML, markdown, and action-plan outputs
- shared Playwright/Lighthouse target verification
- runtime audit remediation
- Windows artifact write hardening
- local release dry-run behavior that remains strict in CI

## Historical Public Surface Checklist

- `package.json` and lockfile root package entries align on `3.1.4`.
- README and docs site advertise source-checkout CLI usage and the `@v3` Action line.
- `configs/default.json` uses the `wqg/3.1.4` default user agent.
- Compatibility docs list `Jahrome907/web-quality-gatekeeper@v3` as the current stable Action usage.
- Published proof artifacts are sanitized for public distribution and align with the package version.
- No personal filesystem paths, secrets, private URLs, or tool-origin wording
  should appear in public docs, examples, release notes, or proof artifacts.

## Historical Required Verification

This was the required verification set before tagging v3.1.4:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run contracts:check`
- `npm run security:audit`
- `npm audit --json`
- `npm run smoke:pack`
- `npm run smoke:action`
- `npm run release:dry-run`
- `git diff --check`

Local `smoke:action` was strict by default and failed when the Bash-side Node
runtime lacked a Playwright browser. Optional probing used
`WQG_ACTION_SMOKE_ALLOW_SKIP=true` explicitly.

## Historical Remote Release Steps

These were the post-merge steps for v3.1.4:

1. Confirm `main` is clean and contains `package.json` version `3.1.4`.
2. Push tag `v3.1.4` at the merge commit.
3. Monitor the release workflow until it creates the GitHub Release.
4. Confirm the stable major tag `v3` points to `v3.1.4`.
5. Confirm the GitHub Pages docs and README show source-checkout CLI guidance and `@v3` usage.
6. Run the separately triggered `NPM Publish` workflow after maintainer npm credentials are configured.

No remote mutation was complete until the GitHub Release and stable major tag
state agreed.
