# Release Handoff

Date: 2026-03-14
Status: archived 3.1.2 release-prep snapshot

This document records the maintainer validation and hardening work that prepared
the `3.1.2` release line. It is kept as an audit trail, not as the current
source of release truth. For the live release gate, use
`docs/engineering/RELEASE_READINESS_CHECKLIST.md`, the tagged GitHub Release,
and the current workflow runs.

## Summary

This release-prep pass included:

- runtime hardening for SSRF-sensitive target resolution, outbound-request
  blocking, redirect handling, and final audited URL enforcement
- workflow hardening for least-privilege smoke paths, checkout credential
  persistence, hermetic repo audits, and tag/package parity during publish
- public release contract alignment around `web-quality-gatekeeper@v3` and the
  `3.1.2` release line
- maintainer-facing docs for contributor orientation, architecture, release
  verification, and repo-settings verification
- a production-audit remediation via `overrides.yauzl = 3.2.1`, which cleared
  the `npm audit --omit=dev` blocker in the Lighthouse transitive dependency
  chain

## Validation Record

The following commands were run successfully during the release-prep closeout:

- `npm run validate:full`
- `npm run contracts:check`
- `npm run security:audit`
- `npm run smoke:pack`
- `npm run smoke:action`
- `npm run python:smoke`
- `npm run release:dry-run`
- `npm run check`

Additional closeout work covered:

- branch reconciliation with `origin/main`
- public contract alignment from `@v1` to `@v3`
- release version bump from `3.1.1` to `3.1.2`
- repo-settings verification and release checklist updates

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

- This file intentionally preserves the maintainer handoff context for the
  `3.1.2` prep cycle.
- Future releases should update the readiness checklist and release notes rather
  than appending in-progress branch state here.
- Historical proof artifacts in `docs/proof/*` should either match the active
  release line or be explicitly labeled as historical.
