import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { runVisualDiff } from "../src/runner/visualDiff.js";

function setPixel(png: PNG, x: number, y: number, rgba: [number, number, number, number]) {
  const idx = (png.width * y + x) * 4;
  png.data[idx] = rgba[0];
  png.data[idx + 1] = rgba[1];
  png.data[idx + 2] = rgba[2];
  png.data[idx + 3] = rgba[3];
}

async function writePng(filePath: string, png: PNG): Promise<void> {
  const buffer = PNG.sync.write(png);
  await writeFile(filePath, buffer);
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

async function createWorkspace() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-visual-native-"));
  const baselineDir = path.join(tempDir, "baselines");
  const diffDir = path.join(tempDir, "diffs");
  const currentDir = path.join(tempDir, "screenshots");

  await Promise.all([
    mkdir(baselineDir, { recursive: true }),
    mkdir(diffDir, { recursive: true }),
    mkdir(currentDir, { recursive: true }),
  ]);

  return { tempDir, baselineDir, diffDir, currentDir };
}

async function createNativeSpikeStub(tempDir: string): Promise<string> {
  const stubPath = path.join(tempDir, "native-spike-stub.mjs");
  const source = `#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
function readFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    throw new Error(\`Missing value for \${flag}\`);
  }
  return args[index + 1];
}

const width = Number.parseInt(readFlag("--width"), 10);
const height = Number.parseInt(readFlag("--height"), 10);
const baselinePath = readFlag("--baseline");
const currentPath = readFlag("--current");
const diffPath = readFlag("--diff-out");
const threshold = Number.parseFloat(readFlag("--threshold"));

const [baseline, current] = await Promise.all([readFile(baselinePath), readFile(currentPath)]);
const diff = Buffer.alloc(width * height * 4);
let diffPixels = 0;
const limit = Math.round(Math.max(0, threshold) * 255);

for (let index = 0; index < baseline.length; index += 4) {
  const maxDelta = Math.max(
    Math.abs(baseline[index] - current[index]),
    Math.abs(baseline[index + 1] - current[index + 1]),
    Math.abs(baseline[index + 2] - current[index + 2]),
    Math.abs(baseline[index + 3] - current[index + 3]),
  );
  if (maxDelta > limit) {
    diff[index] = 255;
    diff[index + 1] = 0;
    diff[index + 2] = 0;
    diff[index + 3] = 255;
    diffPixels += 1;
  }
}

await writeFile(diffPath, diff);
process.stdout.write(JSON.stringify({ diffPixels }));
`;

  await writeFile(stubPath, source, "utf8");
  await chmod(stubPath, 0o755);
  return stubPath;
}

async function createHangingNativeSpikeStub(tempDir: string): Promise<string> {
  const stubPath = path.join(tempDir, "native-spike-hang-stub.mjs");
  const source = `#!/usr/bin/env node
setTimeout(() => {}, 60000);
`;

  await writeFile(stubPath, source, "utf8");
  await chmod(stubPath, 0o755);
  return stubPath;
}

describe("runVisualDiff native spike", () => {
  it("falls back to pixelmatch when the native spike binary is missing", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust-spike", nativeBinaryPath: path.join(tempDir, "missing-bin") }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine requested but no executable was provided; falling back to pixelmatch."
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the native spike when an executable is supplied", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createNativeSpikeStub(tempDir);

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust-spike", nativeBinaryPath }
      );

      expect(summary.failed).toBe(true);
      expect(summary.maxMismatchRatio).toBe(0.25);
      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to pixelmatch when the native spike times out", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createHangingNativeSpikeStub(tempDir);
    const originalTimeout = process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS;

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS = "50";

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust-spike", nativeBinaryPath }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine failed; falling back to pixelmatch. Timed out after 50ms."
      );
    } finally {
      if (originalTimeout === undefined) {
        delete process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS;
      } else {
        process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS = originalTimeout;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
