import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
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

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
};

describe("runVisualDiff", () => {
  it("calculates mismatch ratio and writes diff", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-"));
    const baselineDir = path.join(tempDir, "baselines");
    const diffDir = path.join(tempDir, "diffs");
    const currentDir = path.join(tempDir, "screenshots");

    await Promise.all([
      mkdir(baselineDir, { recursive: true }),
      mkdir(diffDir, { recursive: true }),
      mkdir(currentDir, { recursive: true })
    ]);

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");

    const baseline = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    const current = new PNG({ width: 2, height: 2 });
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [
          {
            name: "home",
            path: currentPath,
            url: "https://example.com",
            fullPage: true
          }
        ],
        baselineDir,
        diffDir,
        false,
        0.2,
        logger
      );

      const result = summary.results[0];
      expect(result).toBeDefined();
      if (!result) {
        throw new Error("Missing visual diff result");
      }
      expect(result.mismatchRatio).toBeCloseTo(0.25, 4);
      expect(summary.failed).toBe(true);
      const diffPath = result.diffPath;
      expect(diffPath).not.toBeNull();
      if (diffPath) {
        const info = await stat(diffPath);
        expect(info.isFile()).toBe(true);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

