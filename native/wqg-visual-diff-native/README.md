# Native Visual Diff Engine

This crate is an optional Rust-backed visual diff engine for Web Quality Gatekeeper.
It can be exercised through the benchmark harness or wired into normal audits as an opt-in runtime path.

## What It Does

- Reads two normalized RGBA buffers from disk (`baseline` and `current`).
- Optionally writes a raw RGBA diff buffer via `--diff-out`.
- Requires explicit `width` and `height`.
- Counts per-pixel mismatches when any channel delta exceeds `--threshold`.
- Emits one JSON object with:
  - `diffPixels`
  - `mismatchRatio`
  - `pixelCount`
  - `elapsedMs`

## Runtime Integration

After building the binary, enable it in a config file:

```json
{
  "visual": {
    "threshold": 0.01,
    "engine": "native-rust",
    "nativeBinaryPath": "native/wqg-visual-diff-native/target/release/wqg-visual-diff-native"
  }
}
```

Or use environment variables for one-off runs:

```bash
WQG_VISUAL_DIFF_ENGINE=native-rust \
WQG_VISUAL_DIFF_NATIVE_BIN=native/wqg-visual-diff-native/target/release/wqg-visual-diff-native \
node dist/cli.js audit https://example.com --config configs/default.json
```

If the binary is missing, times out, or the run requests unsupported `includeAA=true` semantics, Web Quality Gatekeeper falls back to `pixelmatch` automatically.

## Inputs

- Each input file must be raw RGBA bytes (row-major), length `width * height * 4`.
- This engine assumes buffers are pre-normalized to identical dimensions.

## Build

```bash
cargo build --manifest-path native/wqg-visual-diff-native/Cargo.toml --release
```

## Run

```bash
cargo run --manifest-path native/wqg-visual-diff-native/Cargo.toml -- \
  --width 1280 \
  --height 720 \
  --baseline /tmp/baseline.rgba \
  --current /tmp/current.rgba \
  --diff-out /tmp/diff.rgba \
  --threshold 0.05
```

Example output:

```json
{"engine":"wqg-native-rust","width":1280,"height":720,"pixelCount":921600,"diffPixels":3200,"comparablePixels":921600,"mismatchRatio":0.00347222,"threshold":0.05000000,"elapsedMs":7.214}
```
