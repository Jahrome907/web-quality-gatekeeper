# Release Handoff

Date: 2026-03-14
Branch: `chore/open-source-updates`
Status: release-prep in progress; branch is merged with `origin/main` locally and aligned for `3.1.2`, pending cross-platform matrix evidence, repo-settings verification, tracker closeout, and the post-merge release tag

## Summary

This handoff captures the release-prep closeout. The branch now includes:

- runtime hardening for SSRF-sensitive target resolution, outbound-request
  blocking, redirect handling, and final audited URL enforcement
- workflow hardening for least-privilege smoke paths, checkout credential
  persistence, and tag/package parity during publish
- public release contract alignment around `web-quality-gatekeeper@v3` and the
  `3.1.2` release line
- maintainer-facing docs for contributor orientation, architecture, and release
  verification
- a production-audit remediation via `overrides.yauzl = 3.2.1`, which clears the
  `npm audit --omit=dev` blocker in the Lighthouse transitive dependency chain

Open blockers before final release sign-off:

- Cross-platform (Linux/macOS/Windows) package smoke must pass in GitHub
  Actions to back the `yauzl` override on non-Linux environments.
- Repo settings still need manual verification for branch protection, required
  checks, secret/dependency review posture, and restricted release/publish
  access.
- Final closing commit hashes should be recorded once the branch is merged.
- The actual `v3.1.2` tag and GitHub Release / npm publish run are post-merge
  steps and have not been executed from this branch.

## Validation Record

The following commands were run successfully on 2026-03-14 in the repo working tree:

- `npm run validate:full`
- `npm run contracts:check`
- `npm run security:audit`
- `npm run smoke:pack`
- `npm run smoke:action`
- `npm run python:smoke`
- `npm run release:dry-run`

Additional follow-up validation completed locally after the runner hardening pass:

- `npm run check`
- `npm test -- tests/lighthouse.runner.test.ts tests/playwright.runner.test.ts tests/index.orchestration.test.ts tests/workflow.invariants.test.ts tests/case-study.fixture-smoke.test.ts tests/maintainer.docs.test.ts`
- branch reconciliation with `origin/main`
- public contract alignment from `@v1` to `@v3`
- release version bump from `3.1.1` to `3.1.2`

## Evidence

- Public proof artifacts remain under `docs/proof/*`.
- Consumer workflow example remains at `examples/consumer-workflow.yml`.
- Contract and compatibility docs remain under `docs/contracts/*`.
- Maintainer verification commands are documented in `CONTRIBUTING.md`.
- Architecture and change-surface guidance lives in
  `docs/engineering/ARCHITECTURE_MAP.md`.
- Release-settings and final sign-off expectations are tracked in
  `docs/engineering/RELEASE_READINESS_CHECKLIST.md`.

## Notes

- Native benchmark reruns were not required for this release-prep pass because
  the optional visual diff engine surface was not changed; fallback/native
  coverage remains exercised by the default test suite.
- Final closing commit hashes can only be recorded after these
  working-tree changes are committed.
- Historical proof artifacts in `docs/proof/*` remain tied to the earlier
  public proof run and intentionally retain their original version metadata.
