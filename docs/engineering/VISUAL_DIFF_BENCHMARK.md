# Native visual-diff measurements

Version 5 removes the optional Rust engine after the comparison below found no
dependable benefit. See the [v5 migration guide](../migrations/v5.md) for native
configuration changes. Published 4.x tags retain their original behavior.

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
