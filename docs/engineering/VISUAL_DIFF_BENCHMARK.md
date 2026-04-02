# Visual Diff Benchmark Harness

This document defines the benchmark and fallback workflow for the optional
native visual-diff track.

The benchmark harness lives at:

- `benchmarks/visual-diff-benchmark.mjs`
- sample output: `benchmarks/results/visual-diff-benchmark.sample.json`

The optional native engine lives at:

- `native/wqg-visual-diff-native-spike/`

## What the benchmark measures

The harness compares two paths on deterministic synthetic RGBA fixtures:

- the current TypeScript reference engine using `pixelmatch`
- the optional Rust engine invoked through the same file-based adapter contract used by
  `src/runner/visualDiffEngine.ts`

The benchmark intentionally includes process-spawn and temporary-file overhead for the
native engine. That makes the result honest for the current integration seam, rather than
measuring a hypothetical future shared-library path.

Recorded output includes:

- platform and Node metadata
- per-case dimensions and iteration count
- `min`, `max`, and `avg` milliseconds for the TypeScript path
- native status (`ok`, `skipped`, or `error`) plus timings when a native binary is available
- diff pixel counts and mismatch ratios for parity inspection

## Run locally

TypeScript-only baseline:

```bash
node benchmarks/visual-diff-benchmark.mjs --iterations 5 --out /tmp/wqg-visual-bench.json
```

With the Rust engine after building it:

```bash
cargo build --manifest-path native/wqg-visual-diff-native-spike/Cargo.toml --release
node benchmarks/visual-diff-benchmark.mjs \
  --iterations 5 \
  --native-bin native/wqg-visual-diff-native-spike/target/release/wqg-visual-diff-native-spike \
  --out /tmp/wqg-visual-bench.json
```

You can also point the runtime seam at the same binary for an explicit local audit run.
To actually exercise the diff engine instead of only seeding a baseline, run the audit twice
against a visual-enabled config and keep the same baseline directory across both runs:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory tests/fixtures/site

WQG_VISUAL_DIFF_ENGINE=native-rust-spike \
WQG_VISUAL_DIFF_NATIVE_BIN="$PWD/native/wqg-visual-diff-native-spike/target/release/wqg-visual-diff-native-spike" \
node dist/cli.js audit http://127.0.0.1:4173 \
  --config tests/fixtures/visual-only-config.json \
  --out /tmp/wqg-native-visual \
  --baseline-dir /tmp/wqg-native-baselines \
  --allow-internal-targets \
  --no-fail-on-a11y \
  --no-fail-on-perf \
  --set-baseline

WQG_VISUAL_DIFF_ENGINE=native-rust-spike \
WQG_VISUAL_DIFF_NATIVE_BIN="$PWD/native/wqg-visual-diff-native-spike/target/release/wqg-visual-diff-native-spike" \
node dist/cli.js audit http://127.0.0.1:4173 \
  --config tests/fixtures/visual-only-config.json \
  --out /tmp/wqg-native-visual \
  --baseline-dir /tmp/wqg-native-baselines \
  --allow-internal-targets \
  --no-fail-on-a11y \
  --no-fail-on-perf
```

## Native binary contract

The current adapter boundary is deliberately simple so the TypeScript path remains the
default and reference implementation.

Arguments:

```text
--width <px>
--height <px>
--baseline <raw-rgba-path>
--current <raw-rgba-path>
--diff-out <raw-rgba-path>
--threshold <0..1>
```

Inputs and outputs:

- `baseline` and `current` must be normalized raw RGBA buffers with length `width * height * 4`
- `diff-out` must be written as a raw RGBA diff buffer with the same length
- stdout must be one JSON object containing at least `diffPixels`

Current scope boundaries:

- anti-alias-aware diff semantics still belong to the TypeScript path
- the native engine is allowed to fall back automatically when unavailable or unsupported
- no install scripts or required native artifact downloads are allowed in the default consumer path

## Measured decision rule

The benchmark does not assume the native track is faster. It is there to answer:

- does the current adapter seam beat `pixelmatch` enough to justify more native work?
- if not, is the measured slowdown explained by process and file overhead rather than diff math?

Until the benchmark shows a clear benefit, the TypeScript implementation remains the default
and reference implementation.
