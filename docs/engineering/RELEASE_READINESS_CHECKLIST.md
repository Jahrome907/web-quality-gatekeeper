# Release Readiness Checklist

Use this checklist to decide whether the branch is credible as a release candidate and as a public portfolio artifact. It is intentionally stricter than "tests pass."

Current state: provisional. Final release sign-off remains blocked on
cross-platform GitHub Actions evidence and repo-settings verification.

## Code and Runtime

- [x] Core CLI behavior remains backward-compatible for `wqg audit`.
- [x] Known correctness bugs identified in the roadmap are fixed with focused regression tests.
- [x] Config loading, policy resolution, trend history handling, and report generation have contract coverage.
- [x] Runtime error messages are actionable for config, policy, SSRF, auth, and audit failures.
- [x] Security-sensitive defaults remain strict and documented.
- [x] Multi-page case-study claims do not rely on single-page shortcuts.

Date: 2026-03-14

## Contract Compatibility

- [x] `summary.json` stays backward-compatible.
- [x] `summary.v2.json` changes are additive only.
- [x] `action.yml` inputs and outputs remain stable unless additive changes are documented.
- [x] `uses: Jahrome907/web-quality-gatekeeper@v3` remains the documented stable consumer contract.
- [x] Schema docs, runtime output, and schema files are version-aligned.
- [x] Contract drift checks exist so schema and docs mismatches fail visibly.

Date: 2026-03-14

## Test and Evidence

- [x] Default validation suite passes: lint, typecheck, tests, build, `npm audit --omit=dev`.
- [x] Security-sensitive phases also pass `npm run security:audit`.
- [x] Unit, integration, contract, smoke, and workflow-oriented coverage are mapped and current.
- [x] Action smoke verifies more than process startup.
- [x] Packaging smoke verifies tarball contents, CLI entrypoint behavior, and schema availability.
- [ ] Cross-platform package smoke (Linux/macOS/Windows) passes for release-critical dependency overrides.
- [x] Case-study and public-evidence flows have deterministic happy-path checks where applicable.
- [x] Optional Python or native-path additions have isolated smoke or benchmark validation.
- [x] Evidence links to artifacts, logs, or command output needed to prove the gate.

Date: 2026-03-14

## Workflows and Release Safety

- [x] Release tag logic cannot move stable major tags from prerelease tags.
- [x] PR comment behavior is safe for forks and restricted-token contexts.
- [x] Third-party workflow actions follow the repo pinning policy.
- [x] Reusable workflow helpers reduce duplication without hiding workflow intent.
- [x] Workflow permissions are minimally scoped and documented.
- [x] Publish, release, Pages, Action smoke, and pack smoke paths reflect what is actually shipped.
- [ ] `main` branch protection / required checks are verified in GitHub settings.
- [ ] Release and publish paths are restricted to trusted maintainers and protected tag workflows.

Date: 2026-03-14

## Package and Distribution

- [x] `npm pack` output contains the documented runtime files.
- [x] Clean-install tarball smoke succeeds in an isolated project.
- [x] The packaged CLI can execute a basic functional invocation after install.
- [x] Schemas and policy/config assets required by consumers ship in the tarball.
- [x] Action consumption is verified separately from npm package consumption.
- [x] Published examples and docs do not rely on files absent from the package or Action path.

Date: 2026-03-14

## Docs, Examples, and Public Proof

- [x] README install, quickstart, config, output, and workflow guidance match the current product behavior.
- [x] CONTRIBUTING guidance matches the actual maintainer and contributor workflow.
- [x] Public contract docs identify protected interfaces and current schema ownership.
- [x] Examples are executable and match distributed artifacts.
- [x] Migration or compatibility notes exist wherever additive evolution could confuse consumers.
- [x] Case-study docs are reproducible from a clean clone and record provenance inputs.
- [x] `docs/index.html` explains why the tool exists, how it works, why it is trustworthy, and how to adopt it quickly.
- [x] Public screenshots and report walkthroughs reflect real output, not placeholders.
- [x] The public site is responsive, accessible, and visually intentional.
- [x] README, Pages, workflows, and case studies tell a coherent story about value and trust.

Date: 2026-03-14

## Maintainer Readiness

- [x] Maintainers have stable commands for full validation, packaging smoke, Action smoke, and release dry-run checks.
- [x] Contributors can identify where to make changes and how to verify them.
- [x] Architecture and repo-surface maps exist for the main subsystems.
- [x] Templates and contribution guidance set clear quality expectations.
- [ ] All completed milestones record their closing commit hash.

Date: 2026-03-14
