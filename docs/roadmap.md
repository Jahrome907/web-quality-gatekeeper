# Roadmap

Web Quality Gatekeeper is focused on practical CI evidence for web teams. The project roadmap favors small, verifiable improvements over broad platform scope.

## Current Priorities

- Keep the GitHub Action and source-checkout CLI paths stable for consumers.
- Improve merge-review evidence through the PR Risk Ledger artifacts.
- Keep consumer scaffolds useful for first-run setup without making them the release blocker.
- Promote the Rust visual diff engine behind an optional, documented runtime path.
- Keep published proof artifacts reproducible from repository-owned fixtures.
- Keep release evidence artifacts reproducible from package metadata, lockfile state, and release workflow inputs.

## Boundaries

- The project is not a hosted monitoring platform.
- The CLI does not store credentials or remote run history.
- npm publication remains separately authorized through the trusted-publisher workflow and is verified against its corresponding GitHub Release.
