# Native Visual Diff Spike

This crate is an isolated, optional Rust spike for visual-diff benchmarking.
It is intentionally not wired into the TypeScript runtime path.

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

## Inputs

- Each input file must be raw RGBA bytes (row-major), length `width * height * 4`.
- This spike assumes buffers are pre-normalized to identical dimensions.

## Build

```bash
cargo build --manifest-path native/wqg-visual-diff-native-spike/Cargo.toml --release
```

## Run

```bash
cargo run --manifest-path native/wqg-visual-diff-native-spike/Cargo.toml -- \
  --width 1280 \
  --height 720 \
  --baseline /tmp/baseline.rgba \
  --current /tmp/current.rgba \
  --diff-out /tmp/diff.rgba \
  --threshold 0.05
```

Example output:

```json
{"engine":"wqg-native-spike","width":1280,"height":720,"pixelCount":921600,"diffPixels":3200,"comparablePixels":921600,"mismatchRatio":0.00347222,"threshold":0.05000000,"elapsedMs":7.214}
```
