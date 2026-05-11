/* global Buffer, console, process */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_NATIVE_BIN = path.join(
  ROOT,
  "native",
  "wqg-visual-diff-native",
  "target",
  "release",
  process.platform === "win32" ? "wqg-visual-diff-native.exe" : "wqg-visual-diff-native"
);

function parseArgs(argv) {
  const options = {
    out: null,
    iterations: 5,
    nativeBin: process.env.WQG_VISUAL_DIFF_NATIVE_BIN || DEFAULT_NATIVE_BIN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--out") {
      options.out = value;
      index += 1;
    } else if (flag === "--iterations") {
      options.iterations = Number.parseInt(value, 10);
      index += 1;
    } else if (flag === "--native-bin") {
      options.nativeBin = value;
      index += 1;
    } else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${flag}`);
    }
  }

  if (!Number.isInteger(options.iterations) || options.iterations < 1) {
    throw new Error(`Invalid --iterations value: ${options.iterations}`);
  }

  return options;
}

function printUsage() {
  console.log(`Usage: node benchmarks/visual-diff-benchmark.mjs [--iterations <count>] [--native-bin <path>] [--out <path>]

Benchmarks the current pixelmatch path against the optional Rust engine if a native binary is available.`);
}

function createCase(width, height, mutate) {
  const baseline = Buffer.alloc(width * height * 4, 255);
  const current = Buffer.from(baseline);
  mutate(current, width, height);
  return { width, height, baseline, current };
}

function setPixel(buffer, width, x, y, rgba) {
  const offset = (y * width + x) * 4;
  buffer[offset] = rgba[0];
  buffer[offset + 1] = rgba[1];
  buffer[offset + 2] = rgba[2];
  buffer[offset + 3] = rgba[3];
}

function buildCases() {
  return [
    {
      name: "medium-sparse-change",
      ...createCase(1280, 720, (buffer, width) => {
        for (let row = 0; row < 10; row += 1) {
          setPixel(buffer, width, 50 + row, 50, [0, 0, 0, 255]);
        }
      }),
    },
    {
      name: "medium-block-change",
      ...createCase(1280, 720, (buffer, width) => {
        for (let y = 200; y < 320; y += 1) {
          for (let x = 300; x < 420; x += 1) {
            setPixel(buffer, width, x, y, [0, 120, 255, 255]);
          }
        }
      }),
    },
    {
      name: "large-band-change",
      ...createCase(1920, 1080, (buffer, width) => {
        for (let y = 100; y < 160; y += 1) {
          for (let x = 0; x < width; x += 1) {
            setPixel(buffer, width, x, y, [255, 0, 0, 255]);
          }
        }
      }),
    },
  ];
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function summarizeRuns(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    minMs: round(Math.min(...values)),
    maxMs: round(Math.max(...values)),
    avgMs: round(total / values.length),
  };
}

function runPixelmatchCase(testCase, iterations) {
  const runs = [];
  let diffPixels = 0;
  for (let index = 0; index < iterations; index += 1) {
    const diff = Buffer.alloc(testCase.width * testCase.height * 4);
    const startedAt = process.hrtime.bigint();
    diffPixels = pixelmatch(
      testCase.baseline,
      testCase.current,
      diff,
      testCase.width,
      testCase.height,
      { includeAA: false, threshold: 0.1 }
    );
    runs.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
  }

  return {
    diffPixels,
    mismatchRatio: round(diffPixels / (testCase.width * testCase.height), 6),
    ...summarizeRuns(runs),
  };
}

async function runNativeCase(testCase, iterations, nativeBin) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-visual-benchmark-"));
  const baselinePath = path.join(tempDir, "baseline.rgba");
  const currentPath = path.join(tempDir, "current.rgba");
  const diffPath = path.join(tempDir, "diff.rgba");
  await Promise.all([
    writeFile(baselinePath, testCase.baseline),
    writeFile(currentPath, testCase.current),
  ]);

  try {
    const runs = [];
    let parsed = null;

    for (let index = 0; index < iterations; index += 1) {
      const startedAt = process.hrtime.bigint();
      const { stdout } = await execFileAsync(nativeBin, [
        "--width",
        String(testCase.width),
        "--height",
        String(testCase.height),
        "--baseline",
        baselinePath,
        "--current",
        currentPath,
        "--diff-out",
        diffPath,
        "--threshold",
        "0.1",
      ]);
      runs.push(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
      parsed = JSON.parse(stdout.trim());
    }

    const diffBytes = await readFile(diffPath);
    return {
      status: "ok",
      diffBytes: diffBytes.length,
      diffPixels: parsed?.diffPixels ?? null,
      mismatchRatio:
        typeof parsed?.mismatchRatio === "number" ? round(parsed.mismatchRatio, 6) : null,
      ...summarizeRuns(runs),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cases = buildCases();
  const nativeAvailable = await readFile(options.nativeBin).then(
    () => true,
    () => false
  );

  const results = [];
  for (const testCase of cases) {
    const pixelmatchResult = runPixelmatchCase(testCase, options.iterations);
    const nativeResult = nativeAvailable
      ? await runNativeCase(testCase, options.iterations, options.nativeBin)
      : { status: "skipped", message: `Native binary not found at ${options.nativeBin}` };

    results.push({
      name: testCase.name,
      width: testCase.width,
      height: testCase.height,
      iterations: options.iterations,
      pixelmatch: pixelmatchResult,
      native: nativeResult,
    });
  }

  const report = {
    benchmark: "visual-diff",
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    nativeBinaryPath: options.nativeBin,
    nativeAvailable,
    cases: results,
  };

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.out) {
    await writeFile(options.out, serialized, "utf8");
  }
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
