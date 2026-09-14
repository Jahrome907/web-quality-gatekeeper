# Native visual-diff removal

The unreleased development branch uses pixelmatch only. Native Rust execution,
its build tooling, and its CI workflow have been removed for the next major
release. Published 4.x packages and tags are unchanged.

## Migrate a native configuration

- Remove `visual.engine` (or set it to `pixelmatch`) and remove `visual.nativeBinaryPath`.
- Unset `WQG_VISUAL_DIFF_ENGINE` if it selects `native-rust` or `native-rust-spike`.
- Remove `WQG_VISUAL_DIFF_NATIVE_BIN`, `WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS`, `WQG_ALLOW_NATIVE_VISUAL_ENGINE`, and `WQG_ALLOW_SCRIPT_NATIVE_ENGINE` from your environment and workflows.
- Run an audit with your existing baselines and review any changed comparison results. Do not regenerate baselines merely to make a failure pass.

Legacy engine selections fail with migration guidance instead of silently changing
the engine. Default pixelmatch configurations need no change. Historical reports
that record `native-rust` remain valid under the existing summary schema.

## Measured result

A September 2026 comparison used two real page captures, three change patterns,
and the complete `runVisualDiff` path: PNG decoding, normalization, diff output,
and native process startup and temporary-file I/O. Each case had one warmup and
seven measured samples with alternating engine order. Diff-count parity passed
all six cases with `includeAA: true`.

| Capture / change                 | Pixelmatch median | Native median |
| -------------------------------- | ----------------: | ------------: |
| 1280 x 11549 / unchanged         |         1317.4 ms |     1494.2 ms |
| 1280 x 11549 / 20 changed pixels |         1494.5 ms |     1528.9 ms |
| 1280 x 11549 / 4% changed area   |         1968.1 ms |     1949.6 ms |
| 1280 x 2654 / unchanged          |          395.1 ms |      522.1 ms |
| 1280 x 2654 / 20 changed pixels  |          400.3 ms |      430.9 ms |
| 1280 x 2654 / 4% changed area    |          392.1 ms |      400.2 ms |

Native was slower in five cases. The one 18 ms gain was smaller than the observed
run-to-run variation. These results provide no demonstrated benefit for expanding
the integration. They come from one Windows x64 host running Node 22.22.3, with
warm caches and uncontrolled host load; they do not establish cross-platform
performance or include screenshot capture time.
