# Contributing

Thanks for contributing to Web Quality Gatekeeper. Please review the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Development setup

```bash
npm ci
npm run validate:full
```

Install Playwright browsers with the command that matches your OS:

- Linux: `npx playwright install --with-deps chromium`
- macOS / Windows: `npx playwright install chromium`

## Common roles

### Maintainers

Use the stable entrypoints below so local verification matches repo automation:

```bash
npm run validate:full   # lint + typecheck + tests + build + npm audit --omit=dev
npm run contracts:check # summary schema/runtime/doc drift gate
npm run security:audit  # runtime dependency audit exceptions gate
npm run smoke:pack      # clean tarball install + real packaged audit
npm run smoke:action    # local composite-action audit smoke
npm run release:dry-run # full maintainer validation + smoke checks
```

Architecture and release closeout references:

- [Architecture Map](docs/engineering/ARCHITECTURE_MAP.md)
- [Release Handoff](docs/engineering/RELEASE_HANDOFF.md)
- [Testing Matrix](docs/testing-matrix.md)

### Contributors

Most code changes only need:

```bash
npm run check
npm run contracts:check
```

If you change packaging, workflows, or Action behavior, also run the relevant smoke command from the maintainer list.

### Docs-only contributors

For docs, examples, or workflow guidance updates:

```bash
npm run contracts:check
npm run lint
```

## Running locally

```bash
npm run audit -- https://example.com
```

## Testing

Tests live in `tests/` and mirror the `src/` structure.
For CI parity, run the same checks used in repository validation:

```bash
npm run lint
npm run typecheck
npm test
npm run contracts:check
npm run security:audit
```

Additional useful commands:

```bash
npm test                         # run all tests
npx vitest run tests/index.orchestration.test.ts # run a single file
npm run test:coverage            # run with coverage report
```

Integration tests (`tests/integration.test.ts`) spin up a local HTTP server
and exercise the built CLI end-to-end. Packaged consumer smoke lives in
`tests/package.smoke.test.ts`. The current layer mapping is documented in
`docs/testing-matrix.md`, and the main change surfaces are mapped in
`docs/engineering/ARCHITECTURE_MAP.md`.

## Standards

- Use conventional commits (e.g. `feat: add visual diff thresholds`).
- Keep changes scoped and add tests for behavior changes.
- Run `npm run check` before opening a PR.
- Keep `README.md`, `SECURITY.md`, and workflow examples aligned with actual script and workflow behavior.
- Keep submitted code, docs, and artifacts directly verifiable through the repo's tests, smoke checks, or published proof surfaces.

## Workflow safety defaults

- `.github/workflows/quality-gate.yml` is strict by default in both demo and remote modes.
- Set `WQG_RELAXED_REMOTE=true` only when you explicitly want non-blocking remote gates.
- For authenticated or sensitive audits, set `WQG_SENSITIVE_AUDIT=true` and keep `WQG_ALLOW_SENSITIVE_OUTPUTS=false` unless publication is intentional.
- Internal/private targets are blocked in CI or authenticated runs unless you set `--allow-internal-targets` (or `WQG_ALLOW_INTERNAL_TARGETS=true`).
- Release major tags move only for stable release tags (`vX.Y.Z` or `vX.Y.Z+build`) and never for prereleases.
- PR summary comments are best-effort only and are skipped for fork PRs or when the workflow token cannot write comments.
- Repo-owned workflows and the composite Action pin third-party GitHub Actions to immutable SHAs; see `docs/engineering/WORKFLOW_SAFETY_POLICY.md`.

## Pull requests

- Describe the problem and the solution.
- Include screenshots, report snippets, or summary artifacts when relevant.
- Note any follow-up work or known limitations.
- Use the [PR template](.github/pull_request_template.md) as a guide.
