# Roadmap

Web Quality Gatekeeper is focused on practical CI evidence for web teams. The project roadmap favors small, verifiable improvements over broad platform scope.

## Current Priorities

- Keep the GitHub Action and source-checkout CLI paths stable for consumers.
- Improve merge-review evidence through the PR Risk Ledger artifacts.
- Promote the Rust visual diff engine behind an optional, documented runtime path.
- Keep published proof artifacts reproducible from repository-owned fixtures.

## Near-Term Work

- Expand `wqg init` templates with profile-specific comments and baseline guidance.
- Add release provenance artifacts to the GitHub Release workflow when the release surface is ready.
- Publish a maintained SBOM alongside release artifacts once dependency metadata is stable across the package and Action paths.

## Boundaries

- The project is not a hosted monitoring platform.
- The CLI does not store credentials or remote run history.
- npm publication remains separate from the automated GitHub Release path until that distribution lane is fully validated.
