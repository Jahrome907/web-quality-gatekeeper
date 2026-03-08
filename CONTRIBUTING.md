# Contributing

Thanks for contributing to Web Quality Gatekeeper. Please review the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Development setup

```bash
npm ci
npx playwright install --with-deps chromium
npm run check
npm run build
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
npm run security:audit
```

Additional useful commands:

```bash
npm test                         # run all tests
npx vitest run tests/index.orchestration.test.ts # run a single file
npm run test:coverage            # run with coverage report
```

Integration tests (`tests/integration.test.ts`) spin up a local HTTP server
and exercise the built CLI end-to-end. They require a prior `npm run build`.

## Standards

- Use conventional commits (e.g. `feat: add visual diff thresholds`).
- Keep changes scoped and add tests for behavior changes.
- Run `npm run check` before opening a PR.
- Keep `README.md`, `SECURITY.md`, and workflow examples aligned with actual script and workflow behavior.

## Workflow safety defaults

- `.github/workflows/quality-gate.yml` is strict by default in both demo and remote modes.
- Set `WQG_RELAXED_REMOTE=true` only when you explicitly want non-blocking remote gates.
- For authenticated or sensitive audits, set `WQG_SENSITIVE_AUDIT=true` and keep `WQG_ALLOW_SENSITIVE_OUTPUTS=false` unless publication is intentional.
- Internal/private targets are blocked in CI or authenticated runs unless you set `--allow-internal-targets` (or `WQG_ALLOW_INTERNAL_TARGETS=true`).

## Pull requests

- Describe the problem and the solution.
- Include screenshots or report snippets when relevant.
- Note any follow-up work or known limitations.
- Use the [PR template](.github/pull_request_template.md) as a guide.
