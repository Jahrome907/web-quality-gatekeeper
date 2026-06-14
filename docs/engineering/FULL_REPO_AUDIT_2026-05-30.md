# Full Repo Audit - 2026-05-30

Archived engineering record. This document preserves the findings and fixes
from the 2026-05-30 audit pass for historical context. Do not use it as the
current release-readiness statement; run the current validation commands in
`README.md` and `docs/testing-matrix.md` for present evidence.

## Scope

This pass reviewed the CLI, config loading, target safety, report generation,
workflow invariants, consumer scaffolding, packaging, and release-adjacent
validation surfaces for `web-quality-gatekeeper`.

## Findings Fixed

### Workflow invariant was line-ending dependent

- Severity: Medium
- Affected files: `tests/workflow.invariants.test.ts`, `.gitattributes`
- Risk: Windows checkouts could fail invariant tests even when `action.yml`
  still contained the expected hardened checkout and setup steps.
- Fix: Normalize fixture reads in the invariant test and add a repository
  line-ending policy for future checkouts.
- Validation: `npx vitest run tests/workflow.invariants.test.ts`

### Generated Markdown accepted report text without escaping

- Severity: Medium
- Affected files: `src/report/actionPlan.ts`, `src/report/prRiskLedger.ts`
- Risk: Page names, URLs, evidence, or recommendation text could inject links,
  tables, or HTML into Markdown artifacts used in review comments.
- Fix: Escape untrusted Markdown fields before writing action-plan and PR Risk
  Ledger Markdown output.
- Validation: `npx vitest run tests/action-plan.test.ts tests/prRiskLedger.test.ts`

### Native visual diff binaries could run from CI config without an explicit opt-in

- Severity: Medium
- Affected files: `src/runner/visualDiffEngine.ts`,
  `src/runner/nativeVisualDiffSupport.ts`, `src/doctor.ts`, `SECURITY.md`,
  `native/wqg-visual-diff-native/README.md`
- Risk: A CI run that accepted repository config could execute a configured
  native visual diff binary, and diagnostics could drift from runtime safety
  behavior.
- Fix: Keep local native execution available, but require
  `WQG_ALLOW_NATIVE_VISUAL_ENGINE=true` before the native engine runs in CI.
  Share native adapter classification, invocation, and sanitized child-process
  environment logic between runtime execution and `wqg doctor`.
- Validation: `npx vitest run tests/visualDiff.native.test.ts tests/doctor.test.ts`

### Missing stable schema for PR Risk Ledger automation

- Severity: Low
- Affected files: `src/report/prRiskLedger.ts`,
  `schemas/pr-risk-ledger.v1.json`,
  `docs/contracts/pr-risk-ledger-v1-contract.md`
- Risk: Consumers had a useful JSON artifact but no first-class schema contract
  for custom dashboards or PR comments.
- Fix: Add v1 schema metadata to emitted ledgers, ship a JSON Schema, and
  document stability rules.
- Validation: `npx vitest run tests/prRiskLedger.test.ts`

### Schema version patterns rejected valid SemVer release metadata

- Severity: Low
- Affected files: `.github/workflows/npm-publish.yml`,
  `schemas/summary.v1.json`, `schemas/summary.v2.json`,
  `schemas/pr-risk-ledger.v1.json`, `tests/summary.contract-drift.test.ts`,
  `tests/prRiskLedger.test.ts`, `tests/workflow.invariants.test.ts`
- Risk: Valid package versions with both prerelease and build metadata, such as
  `3.1.6-beta.1+build.5`, could be emitted by runtime code but rejected by the
  public JSON Schemas or refused by the manual npm backfill workflow.
- Fix: Update summary and PR Risk Ledger `toolVersion` patterns to accept
  SemVer prerelease and build metadata together, align manual npm publish tag
  validation, and add schema/workflow validation regressions.
- Validation: `npm run contracts:check`; `npx vitest run tests/workflow.invariants.test.ts`

### Consumer setup lacked a quick diagnostics command

- Severity: Low
- Affected files: `src/doctor.ts`, `src/cli.ts`, `README.md`,
  `docs/testing-matrix.md`
- Risk: Consumers had to discover invalid Node versions, config issues, unsafe
  output paths, or missing browsers by running a full audit.
- Fix: Add `wqg doctor` with text and JSON output for Node, config, output path,
  baseline path, and browser checks.
- Validation: `npx vitest run tests/doctor.test.ts`

### `wqg init` guidance was too generic

- Severity: Low
- Affected files: `src/init/templates.ts`, `tests/init.scaffold.test.ts`,
  `README.md`
- Risk: New consumers received the right files but little profile-specific
  guidance for target coverage, cadence, and baseline handling.
- Fix: Add profile-specific README guidance for `marketing`, `docs`,
  `ecommerce`, and `saas` scaffolds.
- Validation: `npx vitest run tests/init.scaffold.test.ts`

### Public report wording read like build-process output

- Severity: Low
- Affected files: `src/report/actionPlan.ts`, `src/report/prRiskLedger.ts`,
  `src/report/trendDashboard.ts`, `src/report/templates/reportTemplate.ts`,
  `docs/proof/fixture-action-plan.md`, `docs/proof/fixture-report.html`
- Risk: Public reports and proof fixtures used unnecessary process-oriented
  wording for empty recommendation states.
- Fix: Replace those strings with product-facing status copy and refresh the
  matching proof fixtures.
- Validation: `npx vitest run tests/action-plan.test.ts tests/prRiskLedger.test.ts tests/report.test.ts tests/report.template.snapshot.test.ts`

### Public proof pages used process-oriented provenance wording

- Severity: Low
- Affected files: `docs/index.html`, `docs/provenance.md`,
  `tests/public.story.test.ts`
- Risk: Public proof pages used unnecessary process-oriented wording around the
  proof bundle instead of describing traceable repository evidence.
- Fix: Reword Pages and provenance copy around source fixtures and proof-bundle
  traceability, and add public-story assertions that avoid brittle HTML
  formatting assumptions.
- Validation: `npx vitest run tests/public.story.test.ts`

### Local test cache could appear as untracked noise

- Severity: Low
- Affected files: `.gitignore`
- Risk: Vitest's Node compile cache could leave `.tmp-vitest/` entries in the
  worktree after local runs.
- Fix: Ignore `.tmp-vitest/` alongside the existing temporary test directories
  and remove the stale local cache.
- Validation: `git ls-files -o --exclude-standard`

### Full release validation could pass on an unsupported Node.js runtime

- Severity: Medium
- Affected files: `scripts/ci/assert-node-engine.mjs`,
  `scripts/ci/release-dry-run.mjs`, `package.json`, `CONTRIBUTING.md`,
  `docs/testing-matrix.md`, `docs/engineering/WORKFLOW_SAFETY_POLICY.md`
- Risk: A maintainer could treat `npm run validate:full` or `npm run release:dry-run`
  as release evidence even when local Node.js does not satisfy
  `package.json` `engines.node`, and maintainer workflow policy could drift
  from the release script behavior.
- Fix: Add `npm run engines:check`, make `validate:full` run it first, and keep
  `release:dry-run` failing fast with a clear message before expensive
  validation starts. Update workflow safety policy to name the Node preflight
  as part of release-sensitive validation.
- Validation: `npx vitest run tests/node-engine.test.ts tests/ci.shared.test.ts tests/workflow.invariants.test.ts tests/maintainer.docs.test.ts`

### Python smoke diagnostics hid spawn failures

- Severity: Low
- Affected files: `scripts/ci/python-smoke.mjs`
- Risk: Local sandbox or interpreter-launch failures could be reported as a
  missing Python interpreter, slowing maintainer triage.
- Fix: Preserve the normal passing output, but include rejected interpreter
  diagnostics when no candidate can run.
- Validation: `npm run python:smoke`

### Packaged API types were present but not advertised

- Severity: Low
- Affected files: `package.json`, `scripts/ci/pack-smoke.mjs`,
  `tests/package.metadata.test.ts`, `docs/contracts/compatibility-baseline.md`,
  `docs/testing-matrix.md`
- Risk: The npm tarball included `dist/index.d.ts`, but TypeScript consumers
  could miss the public API declaration file because package metadata did not
  point at it.
- Fix: Add root package type metadata and export-level type metadata for the
  public API, then make pack smoke assert both the declaration file and package
  metadata are present. Add a fast package metadata invariant for the CLI,
  root ESM entry, type declarations, and shipped asset allowlist.
- Validation: `npx vitest run tests/package.metadata.test.ts`;
  `npm run smoke:pack`

### Maintainer docs had no local reference integrity guard

- Severity: Low
- Affected files: `tests/maintainer.docs.test.ts`
- Risk: README, contribution, workflow, or contract docs could point
  maintainers at missing repo-local files, npm scripts, helper scripts, or
  test files without any fast validation failure.
- Fix: Add a maintainer-docs invariant that walks repository Markdown docs and
  verifies repo-local links resolve to files. Extend the same guard to
  referenced `npm run` scripts, `node scripts/*.mjs` helpers, and test file
  paths used in docs and repo-owned workflow guidance.
- Validation: `npx vitest run tests/maintainer.docs.test.ts`

### Historical release note still read like a current checklist

- Severity: Low
- Affected files: `docs/engineering/RELEASE_3.1.4_READINESS.md`
- Risk: Maintainers could mistake the archived v3.1.4 readiness note for the
  current release checklist and follow stale version-specific steps.
- Fix: Reword the document title, scope, verification, and remote-release
  sections as historical release evidence, with current validation pointers at
  the top.
- Validation: `npx vitest run tests/maintainer.docs.test.ts`

### Default user-agent examples could drift from the package version

- Severity: Low
- Affected files: `tests/public.story.test.ts`
- Risk: The default config and README source-checkout example both show the
  package-versioned user agent, but a future release bump could update public
  proof artifacts while leaving those source-checkout examples stale.
- Fix: Add a public-story invariant tying `configs/default.json` and the README
  example user agent to `package.json` version.
- Validation: `npx vitest run tests/public.story.test.ts`

### Roadmap listed completed scaffold work as future work

- Severity: Low
- Affected files: `docs/roadmap.md`, `tests/maintainer.docs.test.ts`
- Risk: Public roadmap and maintainer planning could keep pointing at
  profile-specific `wqg init` guidance after that scaffold behavior already
  shipped in the current branch.
- Fix: Move scaffold usefulness into current priorities and remove the stale
  near-term item. Extend maintainer-docs coverage so roadmap entries do not
  re-list the completed profile-guidance work.
- Validation: `npx vitest run tests/maintainer.docs.test.ts`

### Changelog omitted current user-facing hardening work

- Severity: Low
- Affected files: `CHANGELOG.md`, `tests/maintainer.docs.test.ts`
- Risk: The branch changed CLI commands, stdout formats, package metadata,
  schema contracts, native-engine safety behavior, smoke diagnostics, and
  maintainer documentation guards without a release-note entry for consumers or
  maintainers preparing the next tag.
- Fix: Add concise `Unreleased` Added, Changed, and Fixed entries covering the
  current hardening surfaces. Extend maintainer-docs coverage so the
  Unreleased section remains non-empty for those release-relevant changes.
- Validation: `npx vitest run tests/maintainer.docs.test.ts`

### Consumer init workflow did not preserve report artifacts

- Severity: Low
- Affected files: `src/init/templates.ts`, `scripts/ci/pack-smoke.mjs`,
  `tests/init.scaffold.test.ts`, `README.md`, `CHANGELOG.md`
- Risk: New consumers using `wqg init` received a workflow that ran the
  composite Action but did not upload the default report artifacts, making
  first-run failures harder to inspect from GitHub Actions.
- Fix: Add the same sensitive-output-aware artifact upload pattern used by the
  checked-in consumer example, document it in the generated README and project
  README, and cover the generated workflow content in scaffold tests and the
  installed-package pack smoke.
- Validation: `npx vitest run tests/init.scaffold.test.ts tests/maintainer.docs.test.ts`;
  `npm run smoke:pack`

### Pack smoke did not assert CLI executable header

- Severity: Low
- Affected files: `scripts/ci/pack-smoke.mjs`, `CHANGELOG.md`,
  `tests/maintainer.docs.test.ts`
- Risk: The tarball smoke verified `dist/cli.js` existed and the installed
  command worked on the current platform, but did not directly pin the packaged
  CLI shebang needed for POSIX npm bin execution.
- Fix: Extract `package/dist/cli.js` from the packed tarball during pack smoke
  and fail if it does not start with the Node shebang. Document the added
  release-note coverage.
- Validation: `npm run smoke:pack`;
  `npx vitest run tests/package.smoke.test.ts tests/maintainer.docs.test.ts`

### Smoke helpers could use stale or mutating built output

- Severity: Medium
- Affected files: `scripts/ci/_shared.mjs`,
  `scripts/ci/local-action-smoke.mjs`, `CHANGELOG.md`,
  `tests/maintainer.docs.test.ts`
- Risk: Local package smoke and CLI integration helpers treated any existing
  `dist/cli.js` and `dist/index.js` as current. Source changes to bundled CLI
  behavior could therefore pass against an outdated tarball until a maintainer
  manually ran `npm run build`. Parallel smoke tests could also rebuild and
  clean repo-root `dist` while local Action smoke was executing the composite
  Action against it.
- Fix: Make the shared build helper compare required `dist` outputs against
  source and build metadata mtimes, then rebuild before smoke or integration
  work when the bundle is stale. Make local Action smoke copy the built Action
  runtime into its temporary workspace and point `GITHUB_ACTION_PATH` at that
  snapshot.
- Validation: `npm run smoke:pack`;
  `npx vitest run tests/package.smoke.test.ts tests/action.local-smoke.test.ts tests/ci.shared.test.ts tests/maintainer.docs.test.ts`

### Direct npm pack from a clean source checkout could omit built entrypoints

- Severity: Medium
- Affected files: `package.json`, `scripts/ci/pack-smoke.mjs`,
  `tests/package.metadata.test.ts`, `CHANGELOG.md`
- Risk: Release workflows and smoke helpers built `dist` before packing, but a
  direct `npm pack` from a clean source checkout could produce a tarball without
  `dist/cli.js`, `dist/index.js`, or public API declarations because the
  `files` allowlist only includes files that exist at pack time.
- Fix: Add a `prepack` lifecycle that runs the build before npm pack/publish,
  make package metadata tests pin that lifecycle, and let pack smoke exercise
  the npm pack lifecycle instead of manually prebuilding first.
- Validation: `npm run smoke:pack`;
  `npx vitest run tests/package.metadata.test.ts tests/package.smoke.test.ts`

### Public consumer workflow snippets omitted artifact upload

- Severity: Low
- Affected files: `README.md`, `docs/index.html`,
  `examples/consumer-workflow.yml`, `src/init/templates.ts`,
  `scripts/ci/pack-smoke.mjs`, `CHANGELOG.md`,
  `tests/init.scaffold.test.ts`, `tests/public.story.test.ts`,
  `tests/workflow.invariants.test.ts`, `tests/maintainer.docs.test.ts`
- Risk: Consumers copying the primary README or Pages Action snippets could run
  the gate successfully but have no uploaded report bundle to inspect after
  failures, even though the scaffold and checked-in example workflow already
  preserved those artifacts. The scaffold and examples also lagged the
  repo-owned checkout and upload-artifact pins.
- Fix: Add the same sensitive-output-aware upload step to the README and Pages
  consumer snippets, align all public/scaffold examples to the current pinned
  checkout and upload-artifact actions, and cover public docs, scaffold smoke,
  workflow invariants, and changelog wording with tests.
- Validation: `npx vitest run tests/init.scaffold.test.ts tests/public.story.test.ts tests/workflow.invariants.test.ts tests/maintainer.docs.test.ts`

### Consumer workflow examples bypassed stable Action artifact path outputs

- Severity: Low
- Affected files: `README.md`, `docs/index.html`,
  `examples/consumer-workflow.yml`, `src/init/templates.ts`,
  `scripts/ci/pack-smoke.mjs`, `tests/init.scaffold.test.ts`,
  `tests/public.story.test.ts`, `tests/workflow.invariants.test.ts`
- Risk: After the composite Action exposed stable artifact path outputs,
  downstream examples still uploaded a hard-coded `artifacts` directory. That
  worked for the current default directory, but it trained consumers to depend
  on implementation paths instead of the Action contract and missed the
  narrower artifact list that smoke tests now prove.
- Fix: Give the Action step `id: wqg` in README, Pages, checked-in consumer
  workflow, and `wqg init` scaffolds, then upload the emitted summary, report,
  Action Plan, and PR Risk Ledger paths from `steps.wqg.outputs.*`. Update pack
  smoke and public/scaffold tests so packaged `wqg init` and public snippets
  keep using the Action-owned path outputs.
- Validation: `npx vitest run tests/package.smoke.test.ts tests/init.scaffold.test.ts tests/public.story.test.ts tests/workflow.invariants.test.ts`;
  `npm run smoke:pack`

### Fixture provenance omitted PR Risk Ledger output paths

- Severity: Low
- Affected files: `scripts/case-study/run-fixture-case-study.mjs`,
  `docs/case-study-run.md`, `docs/provenance.md`,
  `tests/case-study.fixture-smoke.test.ts`
- Risk: The public proof bundle included PR Risk Ledger JSON and Markdown
  artifacts, but the local reproduction manifest did not record those output
  paths. Maintainers could therefore reproduce the fixture run and still miss
  whether the merge-review artifacts were written.
- Fix: Record PR Risk Ledger JSON and Markdown paths in
  `fixture-provenance.json`, update the fixture walkthrough and provenance docs
  to name the current artifact set, and assert the files exist in the fixture
  smoke test.
- Validation: `npx vitest run tests/case-study.fixture-smoke.test.ts tests/maintainer.docs.test.ts tests/public.story.test.ts`

### Public baseline/improved provenance omitted review artifacts

- Severity: Low
- Affected files: `scripts/case-study/write-provenance-manifest.mjs`,
  `docs/case-study/public-oss-repro.md`,
  `tests/case-study.provenance.test.ts`
- Risk: The public case-study protocol required summaries and HTML reports but
  did not bind the Action Plan and PR Risk Ledger outputs into the provenance
  manifest. Published evidence could therefore omit the merge-review artifacts
  that the product now emits by default.
- Fix: Require baseline and improved Action Plan, PR Risk Ledger JSON, and PR
  Risk Ledger Markdown paths in the manifest writer, document the expanded
  evidence bundle, and assert the paths in provenance tests.
- Validation: `npx vitest run tests/case-study.provenance.test.ts tests/maintainer.docs.test.ts tests/public.story.test.ts`

### Fixture provenance allowed missing required evidence paths

- Severity: Low
- Affected files: `scripts/case-study/run-fixture-case-study.mjs`,
  `docs/provenance.md`, `tests/case-study.fixture-smoke.test.ts`,
  `tests/public.story.test.ts`
- Risk: The fixture happy-path manifest could record `null` for required
  Action Plan, PR Risk Ledger, or screenshot paths without failing the case
  study script. That weakened the local reproducibility check even though the
  docs list those artifacts as required output. The provenance note also
  implied the fixture always records Lighthouse output even though performance
  auditing is intentionally disabled in the local fixture config.
- Fix: Require the Action Plan, PR Risk Ledger JSON, PR Risk Ledger Markdown,
  and configured screenshot before writing fixture provenance, and make the
  smoke test assert non-null paths. Reword provenance docs so Lighthouse
  evidence is explicitly optional for fixture runs.
- Validation: `npx vitest run tests/case-study.fixture-smoke.test.ts tests/maintainer.docs.test.ts tests/public.story.test.ts`

### Testing matrix described the contract gate as summary-only

- Severity: Low
- Affected files: `CONTRIBUTING.md`, `docs/testing-matrix.md`,
  `docs/contracts/compatibility-baseline.md`,
  `docs/engineering/ARCHITECTURE_MAP.md`, `.github/workflows/quality-gate.yml`,
  `tests/maintainer.docs.test.ts`, `tests/summary.contract-drift.test.ts`
- Risk: Maintainers could treat `npm run contracts:check` as only a summary
  schema gate even though it also protects the PR Risk Ledger schema and
  contract documentation.
- Fix: Reword maintainer command guidance and the testing matrix to describe
  the combined summary and PR Risk Ledger contract gate. Align the architecture
  map, compatibility baseline, and quality-gate step label, then add docs
  guards that pin the PR Risk Ledger contract references.
- Validation: `npx vitest run tests/maintainer.docs.test.ts tests/summary.contract-drift.test.ts tests/prRiskLedger.test.ts`

### Compatibility baseline listed completed work as planned follow-up

- Severity: Low
- Affected files: `docs/contracts/compatibility-baseline.md`,
  `tests/maintainer.docs.test.ts`, `CHANGELOG.md`
- Risk: Maintainers could chase already-completed correctness and
  contract-drift work instead of the remaining release provenance and SBOM
  publication work.
- Fix: Replace the stale planned-follow-up list with a remaining-follow-up list
  and add maintainer-doc guards that keep completed items out of the baseline.
- Validation: `npx vitest run tests/maintainer.docs.test.ts`

### Release dry-run skipped the Python analytics smoke

- Severity: Low
- Affected files: `scripts/ci/release-dry-run.mjs`, `CONTRIBUTING.md`,
  `README.md`, `docs/testing-matrix.md`,
  `docs/engineering/WORKFLOW_SAFETY_POLICY.md`, `tests/node-engine.test.ts`,
  `tests/maintainer.docs.test.ts`, `CHANGELOG.md`
- Risk: Maintainers could treat the release dry-run as full release-prep
  evidence while the Python analytics bundle only had a separately run smoke
  check.
- Fix: Include `npm run python:smoke` in `release:dry-run` and align the
  maintainer command map, testing matrix, workflow safety policy, changelog,
  and release-preflight regression tests.
- Validation: `npx vitest run tests/node-engine.test.ts tests/maintainer.docs.test.ts`;
  `npm run python:smoke`

### Pull request checklist omitted Python analytics smoke routing

- Severity: Low
- Affected files: `.github/pull_request_template.md`,
  `tests/workflow.invariants.test.ts`, `tests/maintainer.docs.test.ts`,
  `CHANGELOG.md`
- Risk: Python analytics changes could pass review with no checklist nudge to
  run the dedicated Python smoke or the release dry-run that now includes it.
- Fix: Add Python analytics smoke routing to the PR testing checklist and pin
  the checklist language in workflow invariant coverage.
- Validation: `npx vitest run tests/workflow.invariants.test.ts tests/maintainer.docs.test.ts`

### Python smoke left bytecode cache output in the repo

- Severity: Low
- Affected files: `scripts/ci/python-smoke.mjs`, `tests/python-smoke.test.ts`,
  `docs/testing-matrix.md`, `tests/maintainer.docs.test.ts`, `CHANGELOG.md`
- Risk: Running the Python analytics smoke could leave ignored `__pycache__`
  directories in the repository, adding local residue after release-prep
  validation.
- Fix: Run Python interpreter probes and unittest discovery with
  `PYTHONDONTWRITEBYTECODE=1`, add a focused invariant, and document the
  cache-free smoke coverage in the testing matrix.
- Validation: `npx vitest run tests/python-smoke.test.ts tests/maintainer.docs.test.ts`;
  `npm run python:smoke`

### Release dry-run reran the runtime audit unnecessarily

- Severity: Low
- Affected files: `scripts/ci/release-dry-run.mjs`,
  `tests/node-engine.test.ts`, `docs/engineering/WORKFLOW_SAFETY_POLICY.md`,
  `tests/maintainer.docs.test.ts`, `CHANGELOG.md`
- Risk: Release dry-runs performed the runtime dependency audit twice because
  `validate:full` already enforces `npm run security:audit`, adding avoidable
  network/runtime work to release-prep validation.
- Fix: Keep `validate:full` as the runtime audit owner, remove the duplicate
  release-dry-run audit command, and pin the command order plus policy wording
  in tests.
- Validation: `npx vitest run tests/node-engine.test.ts tests/maintainer.docs.test.ts`;
  `npm run security:audit`

### Quality gate workflow reran the runtime audit unnecessarily

- Severity: Low
- Affected files: `.github/workflows/quality-gate.yml`,
  `tests/workflow.invariants.test.ts`, `tests/maintainer.docs.test.ts`,
  `CHANGELOG.md`
- Risk: Pull request and main-branch quality-gate runs executed
  `npm run security:audit` twice because `npm run validate:full` already
  includes the runtime audit gate.
- Fix: Remove the duplicate workflow audit step and add a workflow invariant so
  `validate:full` remains the single runtime-audit owner in that workflow.
- Validation: `npx vitest run tests/workflow.invariants.test.ts tests/maintainer.docs.test.ts`;
  `npm run security:audit`

### Manual npm publish workflow bypassed shared maintainer validation

- Severity: Low
- Affected files: `.github/workflows/npm-publish.yml`,
  `tests/workflow.invariants.test.ts`, `tests/maintainer.docs.test.ts`,
  `CHANGELOG.md`
- Risk: The manual npm publish workflow hand-rolled `check`, `security:audit`,
  and `build`, which could drift from `validate:full` and skip shared release
  preflight behavior such as the package Node engine check.
- Fix: Run `npm run validate:full` and `npm run contracts:check` in the
  workflow's package verification step, then keep the existing pack smoke and
  tag/package parity checks.
- Validation: `npx vitest run tests/workflow.invariants.test.ts tests/maintainer.docs.test.ts`;
  `npm run contracts:check`

### README repo-development command list omitted shared release validation

- Severity: Low
- Affected files: `README.md`, `tests/maintainer.docs.test.ts`,
  `CHANGELOG.md`
- Risk: Public maintainer setup guidance listed the lower-level gates but did
  not include `npm run engines:check` or `npm run validate:full`, even though
  those are now the shared validation entrypoints used by release-sensitive
  workflows.
- Fix: Add the Node engine preflight and full validation command to the README
  repo-development command list, and remove the redundant standalone build line
  already covered by `validate:full`.
- Validation: `npx vitest run tests/maintainer.docs.test.ts`

### Native visual diff smoke used the runner's ambient Node runtime

- Severity: Low
- Affected files: `.github/workflows/native-visual-diff.yml`,
  `tests/workflow.invariants.test.ts`, `CHANGELOG.md`
- Risk: The native visual diff workflow runs an npm smoke helper after the
  Rust build, but it did not install a pinned Node runtime first. That left the
  smoke result dependent on the hosted runner image's default Node/npm versions
  instead of the repo-owned workflow runtime.
- Fix: Add the same pinned Node 24 setup used by the other repo-owned
  validation workflows, with package-manager caching disabled because this job
  does not install npm dependencies.
- Validation: `npx vitest run tests/workflow.invariants.test.ts`

### Native visual diff workflow missed support-helper changes

- Severity: Low
- Affected files: `.github/workflows/native-visual-diff.yml`,
  `tests/workflow.invariants.test.ts`, `docs/testing-matrix.md`,
  `CHANGELOG.md`
- Risk: Changes to `src/runner/nativeVisualDiffSupport.ts` affect native
  engine path classification, CI fallback behavior, and child-process
  invocation, but the native visual diff workflow path filters did not include
  that file. A pull request could change native runtime support without running
  the Rust matrix or binary smoke workflow.
- Fix: Add the support helper to the workflow path filters, document it in the
  testing matrix, and pin the trigger coverage in the workflow invariant test.
- Validation: `npx vitest run tests/workflow.invariants.test.ts tests/maintainer.docs.test.ts`

### Source-checkout proof docs skipped the Node preflight

- Severity: Low
- Affected files: `README.md`, `CONTRIBUTING.md`, `docs/index.html`,
  `docs/case-study-run.md`, `docs/provenance.md`,
  `.github/workflows/quality-gate.yml`, `.github/workflows/release.yml`,
  `.github/workflows/npm-pack-smoke.yml`, `.github/workflows/npm-publish.yml`,
  `action.yml`, `docs/engineering/WORKFLOW_SAFETY_POLICY.md`,
  `tests/maintainer.docs.test.ts`, `tests/workflow.invariants.test.ts`,
  `CHANGELOG.md`
- Risk: Public source-checkout and proof-reproduction commands could send a
  maintainer into dependency installation, browser installation, build, or
  fixture execution before the repo's explicit Node engine preflight. The same
  drift existed in repo-owned workflow setup paths. That made unsupported Node
  runtimes easier to miss before collecting release evidence.
- Fix: Add `npm run engines:check` to source-checkout and proof reproduction
  command blocks and workflow setup paths before dependency and browser
  installation, document it in the case-study checklist and workflow policy,
  and guard the command order in maintainer docs and workflow invariant tests.
- Validation: `npx vitest run tests/maintainer.docs.test.ts tests/workflow.invariants.test.ts`

### Runtime config inheritance skipped schema bounds

- Severity: Low
- Affected files: `src/config/schema.ts`, `src/config/loadConfig.ts`,
  `tests/config.test.ts`
- Risk: The schema declared limits for `extends`, but the loader removed
  `extends` before final schema validation. A config could therefore provide
  too many or overlong inheritance references and force unnecessary path
  resolution work before failing.
- Fix: Export the schema limit constants and enforce them in the layered config
  loader before resolving inheritance references.
- Validation: `npx vitest run tests/config.test.ts tests/config.schema.boundaries.test.ts tests/policies.test.ts tests/action.policy-resolution.test.ts`

### Policy-prefixed custom paths resolved differently in CLI and Action paths

- Severity: Low
- Affected files: `src/config/policies.ts`, `tests/policies.test.ts`
- Risk: The composite Action already treated `policy:configs/custom.json` as a
  workspace-relative custom path, but the TypeScript resolver treated the
  `policy:` prefix as part of the path. Direct CLI users could see different
  behavior from Action users for the same policy reference.
- Fix: Strip `policy:` for non-built-in custom paths, reject empty `policy:`
  references with the existing actionable error, and cover the custom-path
  behavior in policy tests.
- Validation: `npx vitest run tests/policies.test.ts tests/action.policy-resolution.test.ts`

### Internal fallback config drifted from the shipped default config

- Severity: Low
- Affected files: `src/config/defaultConfig.ts`, `tests/config.test.ts`
- Risk: Consumer configs produced by `wqg init` can rely mostly on `extends`,
  which means the loader's internal fallback supplies unspecified fields. The
  internal fallback user agent had drifted from `configs/default.json` and the
  public README example.
- Fix: Align the internal fallback user agent with `configs/default.json`, then
  add a config invariant that compares the internal default object to the
  parsed shipped default config.
- Validation: `npx vitest run tests/config.test.ts tests/public.story.test.ts tests/package.metadata.test.ts`

### Fixture reproducibility checklist read like completed local evidence

- Severity: Low
- Affected files: `scripts/case-study/run-fixture-case-study.mjs`,
  `docs/case-study-run.md`, `docs/provenance.md`, `CHANGELOG.md`,
  `tests/case-study.fixture-smoke.test.ts`, `tests/maintainer.docs.test.ts`
- Risk: The reusable fixture checklist said `npm run engines:check` had already
  confirmed the current runtime, which contradicted machines where the Node
  preflight correctly fails. The fixture provenance manifest also did not
  record whether the runtime satisfied the package floor, so unsupported local
  runs could look like release-grade reproduction evidence.
- Fix: Reword prerequisite checklist items as actions to confirm before
  treating a run as release evidence, record the Node engine preflight result
  in `fixture-provenance.json`, and keep required artifact coverage in the same
  checklist.
- Validation: `npx vitest run tests/case-study.fixture-smoke.test.ts tests/maintainer.docs.test.ts tests/public.story.test.ts`

### Screenshot path validation allowed protocol-relative navigation

- Severity: Medium
- Affected files: `src/config/schema.ts`, `src/runner/playwright.ts`,
  `tests/config.schema.boundaries.test.ts`, `tests/playwright.test.ts`,
  `SECURITY.md`
- Risk: Screenshot paths are intended to stay target-relative, but paths such
  as `//example.test/path` could be accepted and then resolved by `new URL()` as
  a cross-host navigation.
- Fix: Reject protocol-relative screenshot paths in both config schema
  validation and runtime path validation, while keeping `@target` and
  single-slash target-relative paths valid.
- Validation: `npx vitest run tests/config.schema.boundaries.test.ts tests/playwright.test.ts tests/playwright.runner.test.ts`

## Validation Evidence

Historical validation covered the repo's maintained test, build, contract,
security, package-smoke, Action-smoke, Python-smoke, documentation, and public
wording gates for this audit pass. The original machine-specific runner notes
are intentionally omitted from this public archive. Treat only freshly run
commands from the current testing matrix as release evidence.

## Remaining Notes

- No push, publish, deploy, tag, GitHub Release creation, or `npm publish` was
  performed.
- npm package ownership and trusted-publisher setup remain outside this repo
  audit scope.
