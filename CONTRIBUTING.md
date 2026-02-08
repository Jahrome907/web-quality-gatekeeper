# Contributing

Thanks for contributing to Web Quality Gatekeeper. Please review the
[Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Development setup

```bash
npm ci
npm run check
npm run build
```

## Running locally

```bash
npm run audit -- https://example.com
```

## Testing

Tests live in `tests/` and mirror the `src/` structure:

```bash
npm test                         # run all tests
npx vitest run tests/cli.test.ts # run a single file
npm run test:coverage            # run with coverage report
```

Integration tests (`tests/integration.test.ts`) spin up a local HTTP server
and exercise the built CLI end-to-end. They require a prior `npm run build`.

## Standards

- Use conventional commits (e.g. `feat: add visual diff thresholds`).
- Keep changes scoped and add tests for behavior changes.
- Run `npm run check` before opening a PR.

## Pull requests

- Describe the problem and the solution.
- Include screenshots or report snippets when relevant.
- Note any follow-up work or known limitations.
- Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md) as a guide.
