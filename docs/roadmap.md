# Roadmap

Web Quality Gatekeeper focuses on verifiable CI evidence for web teams.

Current priorities:

- keep the stable GitHub Action, npm CLI, and source builds compatible
- make first-run visual setup explicit: reviewed, committed baselines or a deliberately disabled visual toggle
- strengthen reproducible proof, provenance, release integrity, and consumer smoke coverage
- improve useful reports and merge-review evidence without expanding the default artifact set
- retain optional tooling only when consumer demand and measured results justify it

Version 5 uses pixelmatch exclusively. See the [migration guide](migrations/v5.md) and [measurements](engineering/VISUAL_DIFF_BENCHMARK.md) for removal of the optional native Rust engine. Published 4.x releases are unchanged.

The project is not a hosted monitoring service, credential store, or remote run-history platform. Proposed work should fit the local CLI and GitHub Action model and include a testable consumer outcome.
