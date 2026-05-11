# SBOM

Web Quality Gatekeeper does not currently publish a standalone release SBOM artifact. Dependency transparency is maintained through the lockfile, Dependabot updates, runtime audit gate, and release notes.

## Current Verification

- Runtime dependency advisories are checked with `npm run security:audit`.
- Dependency changes are reviewed through grouped Dependabot PRs.
- The package smoke test installs the generated tarball in a clean consumer project and verifies shipped assets.

## Planned SBOM Path

The intended release path is to generate an SPDX or CycloneDX SBOM during the release workflow, attach it to the GitHub Release, and document the exact generator command here.

Until that is available, consumers should inspect:

- `package-lock.json`
- `configs/security/audit-exceptions.json`
- GitHub Release notes
- GitHub Actions check results for the release commit
