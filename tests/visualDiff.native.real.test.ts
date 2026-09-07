import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runVisualDiff } from "../src/runner/visualDiff.js";

const binaryName =
  process.platform === "win32" ? "wqg-visual-diff-native.exe" : "wqg-visual-diff-native";
const nativeBinaryPath = path.join(
  process.cwd(),
  "native",
  "wqg-visual-diff-native",
  "target",
  "release",
  binaryName
);

function setPixel(png: PNG, x: number, y: number, rgba: [number, number, number, number]) {
  const offset = (png.width * y + x) * 4;
  png.data.set(rgba, offset);
}

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

async function writePng(filePath: string, png: PNG): Promise<void> {
  await writeFile(filePath, PNG.sync.write(png));
}

const nativeBinaryIsAvailable = existsSync(nativeBinaryPath);
const nativeBinaryRequired = process.env.WQG_REQUIRE_NATIVE_BINARY === "true";
const describeBuiltBinary =
  nativeBinaryIsAvailable || nativeBinaryRequired ? describe : describe.skip;

describeBuiltBinary("built native visual diff adapter", () => {
  const originalNativeEngineAllowance = process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (originalNativeEngineAllowance === undefined) {
      delete process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
    } else {
      process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = originalNativeEngineAllowance;
    }
    await Promise.all(
      tempDirs.splice(0).map((tempDir) => rm(tempDir, { recursive: true, force: true }))
    );
  });

  it("uses the built binary and preserves pixelmatch parity for opaque and alpha pixels", async () => {
    expect(
      nativeBinaryIsAvailable,
      `Native visual diff binary was not built: ${nativeBinaryPath}`
    ).toBe(true);
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-native-real-"));
    tempDirs.push(tempDir);
    const baselineDir = path.join(tempDir, "baselines");
    const currentDir = path.join(tempDir, "screenshots");
    const nativeDiffDir = path.join(tempDir, "native-diffs");
    const pixelmatchDiffDir = path.join(tempDir, "pixelmatch-diffs");
    await Promise.all(
      [baselineDir, currentDir, nativeDiffDir, pixelmatchDiffDir].map((directory) =>
        mkdir(directory, { recursive: true })
      )
    );

    const screenshotPath = path.join(currentDir, "fixture.png");
    const baseline = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    setPixel(baseline, 1, 0, [0, 50, 200, 0]);
    await writePng(screenshotPath, baseline);

    const baselineLogger = createLogger();
    await runVisualDiff(
      [{ name: "fixture", path: screenshotPath, url: "https://fixture.example", fullPage: true }],
      baselineDir,
      nativeDiffDir,
      true,
      0,
      baselineLogger
    );

    const current = new PNG({ width: 2, height: 2 });
    current.data.set(baseline.data);
    setPixel(current, 0, 0, [0, 0, 0, 255]);
    setPixel(current, 1, 0, [0, 100, 20, 17]);
    await writePng(screenshotPath, current);

    process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = "true";
    const nativeLogger = createLogger();
    const nativeSummary = await runVisualDiff(
      [{ name: "fixture", path: screenshotPath, url: "https://fixture.example", fullPage: true }],
      baselineDir,
      nativeDiffDir,
      false,
      0,
      nativeLogger,
      { engine: "native-rust", nativeBinaryPath, pixelmatch: { includeAA: true, threshold: 0.02 } }
    );
    const pixelmatchLogger = createLogger();
    const pixelmatchSummary = await runVisualDiff(
      [{ name: "fixture", path: screenshotPath, url: "https://fixture.example", fullPage: true }],
      baselineDir,
      pixelmatchDiffDir,
      false,
      0,
      pixelmatchLogger,
      { pixelmatch: { includeAA: true, threshold: 0.02 } }
    );

    const nativeResult = nativeSummary.results[0];
    const pixelmatchResult = pixelmatchSummary.results[0];
    expect(nativeResult?.engine).toBe("native-rust");
    expect(nativeLogger.warn).not.toHaveBeenCalled();
    expect(nativeResult?.mismatchRatio).toBe(pixelmatchResult?.mismatchRatio);
    expect(nativeSummary.failed).toBe(pixelmatchSummary.failed);
    expect(nativeResult?.mismatchRatio).toBe(0.25);
    expect(nativeResult?.diffPath).not.toBeNull();

    const nativeDiff = PNG.sync.read(await readFile(nativeResult!.diffPath!));
    expect([nativeDiff.width, nativeDiff.height]).toEqual([2, 2]);
    expect(Array.from(nativeDiff.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(nativeDiff.data.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });
});
