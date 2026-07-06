# SBOM

Web Quality Gatekeeper publishes a release-scoped SPDX 2.3 SBOM as `sbom.spdx.json` with GitHub Release artifacts. The release workflow generates it with `npm run release:evidence` from `package.json`, `package-lock.json`, and the packed tarball metadata when available.

## Current Verification

- Runtime dependency advisories are checked with `npm run security:audit`; build/test toolchain advisories are checked with `npm run security:audit:toolchain`.
- Dependency changes are reviewed through grouped Dependabot PRs.
- The package smoke test installs the generated tarball in a clean consumer project and verifies shipped assets.
- `npm run release:evidence` writes `artifacts/release/sbom.spdx.json` and `artifacts/release/release-provenance.json` for local inspection.

## Release Artifact

Consumers should inspect these release files together:

- `sbom.spdx.json`
- `release-provenance.json`
- `package-lock.json`
- `configs/security/audit-exceptions.json`
- GitHub Release notes
- GitHub Actions check results for the release commit
