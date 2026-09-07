# Contributing

Thanks for contributing to Web Quality Gatekeeper. Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the private channel in [SECURITY.md](SECURITY.md), not a public issue.

## Set up a source checkout

```bash
npm run engines:check
npm ci
npx playwright install chromium
npm run build
```

On Linux hosts that need browser system dependencies, use `npx playwright install --with-deps chromium`.

Run a local audit with:

```bash
npm run audit -- https://example.com --set-baseline
npm run audit -- https://example.com
```

The first command explicitly creates visual baselines. Review the images before
using them for comparison; ordinary audits fail when a required baseline is missing.

## Choose the narrowest validation

For most code changes:

```bash
npm run check
npm run contracts:check
```

For docs and examples:

```bash
npx prettier --check README.md CONTRIBUTING.md docs
npx vitest run tests/maintainer.docs.test.ts
```

Use the relevant smoke check when a change crosses a distribution boundary:

- `npm run smoke:action` for `action.yml` or consumer Action behavior
- `npm run smoke:pack` for packaged files or CLI installation
- `npm run python:smoke` for the optional Python analytics bundle
- `npm run native:visual-diff:smoke` for the Rust adapter path
- `npm run release:dry-run` for release preparation

`npm run validate:full` is the comprehensive engine, lint, type, build, test, and dependency-audit gate. Do not treat a skipped optional smoke as release evidence.

The [architecture map](docs/engineering/ARCHITECTURE_MAP.md) identifies subsystem ownership. The [testing matrix](docs/testing-matrix.md) maps behavior to its narrowest reliable test layer. Summary and PR Risk Ledger changes must stay aligned with their schemas and contract docs through `npm run contracts:check`.

## Change expectations

- Keep changes scoped and follow existing patterns.
- Add the narrowest regression test for behavior changes.
- Keep public examples aligned with the Action, CLI, and emitted artifacts.
- Never commit credentials, private URLs, authenticated screenshots, or reports from internal sites.
- Preserve compatibility for documented CLI flags, Action inputs/outputs, and JSON contracts unless the change includes an explicit migration.
- Use conventional commit subjects that describe the project change.

Workflow and release-sensitive changes must preserve the rules in [the workflow safety policy](docs/engineering/WORKFLOW_SAFETY_POLICY.md), including immutable Action pins, least-privilege permissions, sensitive-output controls, and stable-tag guards.

## Pull requests

Use one short-lived branch per focused change, based on `main`. Keep `main`
releasable; do not combine unrelated features in a long-lived development branch.
When a change depends on an unmerged PR, branch from that PR and name the dependency
in the description. After its parent merges, rebase the dependent changes onto
`main`, retarget the PR, and rerun its checks before merging. Delete merged topic
branches once their work is preserved.

Describe the problem, the chosen change, and the validation performed. Include screenshots or report excerpts when user-visible output changes, and identify known limitations or follow-up work. The [pull request template](.github/pull_request_template.md) is a checklist, not a requirement to run unrelated gates.

New pull requests automatically keep `Jahrome907` assigned and add an existing label
when the conventional title identifies its work: `fix` for `bug`, `feat` for
`enhancement`, `docs` for `documentation`, `ci` for `github_actions`, and `deps` or
`dependencies` for `dependencies`. The automation only adds metadata. It preserves
manual labels and assignees. An unfamiliar title receives `needs-triage`; after
classifying it, a maintainer removes that fallback label and applies the relevant
existing label.

## Deployments and releases

Merging code and publishing it are separate decisions. Once the intended `main`
commit has passed CI and deployment is approved, run **Deploy Pages** manually
from `main` (or `gh workflow run pages.yml --ref main`). The workflow refuses to
deploy other branches. A merge alone does not deploy the documentation site.

Prepare a version and changelog only after the included PRs are reviewed and
integrated. Run `npm run release:dry-run` on that candidate, then publish the exact
validated commit through the existing tag/Release and npm workflows. Do not use a
release or deployment as a substitute for candidate validation.
