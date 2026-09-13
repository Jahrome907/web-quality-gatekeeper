# Visual diff engines and benchmarks

`pixelmatch` is the default engine. The optional `native-rust` engine is deprecated
and will be retired in the next major release. Existing native configurations,
binary execution, fallback behavior, and security checks remain supported in 4.x.
See [the retirement plan](https://github.com/Jahrome907/web-quality-gatekeeper/issues/133).

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

## Existing synthetic benchmark

[The harness](../../benchmarks/visual-diff-benchmark.mjs) compares synthetic RGBA
fixtures, including native process and temporary-file overhead. It does not
include PNG decoding and encoding. [The sample result](../../benchmarks/results/visual-diff-benchmark.sample.json)
is historical and uses this narrower measurement.

```bash
node benchmarks/visual-diff-benchmark.mjs --iterations 5 --out artifacts/visual-bench.json

npm run native:visual-diff:build
node benchmarks/visual-diff-benchmark.mjs \
  --iterations 5 \
  --native-bin native/wqg-visual-diff-native/target/release/wqg-visual-diff-native \
  --out artifacts/visual-bench.json
```

On Windows, the compiled binary has an `.exe` extension.

## Native compatibility in 4.x

Native execution requires `visual.pixelmatch.includeAA: true`; unsupported or
unavailable native execution falls back to pixelmatch. The default installation
has no native download or required Rust toolchain.

The [Rust binary](../../native/wqg-visual-diff-native/src/main.rs) accepts
`--width`, `--height`, `--baseline`, `--current`, `--diff-out`, and `--threshold`.
The three file arguments use normalized raw RGBA buffers of `width * height * 4`
bytes. Standard output is a JSON object containing `diffPixels`.

Existing users can keep their reviewed binary configuration during 4.x. For new
configurations, use pixelmatch. Consult [SECURITY.md](../../SECURITY.md) before
allowing native binary execution.
