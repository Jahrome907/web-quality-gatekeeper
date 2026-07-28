# Software Bill of Materials

Web Quality Gatekeeper can produce an SPDX 2.3 software bill of materials from a source checkout:

```bash
npm ci
npm run build
npm run release:evidence
```

The command writes `artifacts/release/sbom.spdx.json` alongside `release-provenance.json`, using package metadata, lockfile state, and packed-tarball metadata when available.

For a published version, inspect that GitHub Release's attached assets and verify the SBOM against its provenance, source commit, `package-lock.json`, and `configs/security/audit-exceptions.json`. A file produced locally from `main` is not proof that the same file was attached to a Release.

Runtime dependencies are checked with `npm run security:audit`; the broader toolchain check is `npm run security:audit:toolchain`. Package smoke tests install the tarball in a clean consumer project and verify its shipped files.
