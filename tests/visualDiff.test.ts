import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
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

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

async function createWorkspace() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-visual-"));
  const baselineDir = path.join(tempDir, "baselines");
  const diffDir = path.join(tempDir, "diffs");
  const currentDir = path.join(tempDir, "screenshots");

  await Promise.all([
    mkdir(baselineDir, { recursive: true }),
    mkdir(diffDir, { recursive: true }),
    mkdir(currentDir, { recursive: true })
  ]);

  return { tempDir, baselineDir, diffDir, currentDir };
}

describe("runVisualDiff", () => {
  it("creates baseline artifacts when baseline is missing", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

    const currentPath = path.join(currentDir, "home.png");
    const current = new PNG({ width: 2, height: 2 });
    current.data.fill(255);
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
        0.1,
        logger
      );

      expect(summary.failed).toBe(false);
      expect(summary.results[0]).toEqual({
        name: "home",
        currentPath,
        baselinePath: path.join(baselineDir, "home.png"),
        diffPath: null,
        mismatchRatio: null,
        status: "baseline_created"
      });

      const manifestRaw = await readFile(path.join(baselineDir, "baseline-manifest.json"), "utf8");
      const manifest = JSON.parse(manifestRaw) as { checksums: Record<string, string> };
      expect(manifest.checksums["home.png"]).toHaveLength(64);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("updates baseline when setBaseline is true", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");

    const baseline = new PNG({ width: 1, height: 1 });
    baseline.data.fill(0);
    const current = new PNG({ width: 1, height: 1 });
    current.data.fill(255);

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
        true,
        0.1,
        logger
      );

      expect(summary.results[0]?.status).toBe("baseline_updated");
      expect(summary.results[0]?.diffPath).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns zero mismatch for identical images", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");

    const baseline = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    const current = new PNG({ width: 2, height: 2 });
    current.data.fill(255);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger
      );

      expect(summary.failed).toBe(false);
      expect(summary.results[0]?.mismatchRatio).toBe(0);
      const diffPath = summary.results[0]?.diffPath;
      expect(diffPath).toBeTruthy();
      if (diffPath) {
        const info = await stat(diffPath);
        expect(info.isFile()).toBe(true);
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles dimension mismatch by normalizing to max width and height", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");

    const baseline = new PNG({ width: 2, height: 1 });
    baseline.data.fill(255);
    const current = new PNG({ width: 1, height: 2 });
    current.data.fill(255);
    setPixel(current, 0, 1, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        1,
        logger
      );

      expect(summary.results[0]?.mismatchRatio).toBeGreaterThan(0);
      expect(summary.results[0]?.mismatchRatio).toBeLessThanOrEqual(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps comparison passing at exact threshold boundary", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

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
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0.25,
        logger
      );

      expect(summary.results[0]?.mismatchRatio).toBeCloseTo(0.25, 4);
      expect(summary.failed).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails comparison when mismatch is above threshold", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

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
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0.24,
        logger
      );

      expect(summary.failed).toBe(true);
      expect(summary.maxMismatchRatio).toBeCloseTo(0.25, 4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("flags integrity mismatch from baseline manifest and skips diffing", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");

    const baseline = new PNG({ width: 1, height: 1 });
    baseline.data.fill(255);
    const current = new PNG({ width: 1, height: 1 });
    current.data.fill(0);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    const checksum = createHash("sha256").update(Buffer.from("not-real")).digest("hex");
    await writeFile(
      path.join(baselineDir, "baseline-manifest.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        checksums: {
          "home.png": checksum
        }
      })
    );

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger
      );

      expect(summary.failed).toBe(true);
      expect(summary.results[0]).toEqual({
        name: "home",
        currentPath,
        baselinePath,
        diffPath: null,
        mismatchRatio: null,
        status: "diffed"
      });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Baseline integrity check failed"));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("Skipping comparison"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.todo(
    "ignore regions mask excluded areas before mismatch calculation [Owner: Agent 1] [Tracking: VISDIFF-IGNORE-REGIONS-TODO] [Issue: unassigned] [Acceptance: close when runVisualDiff applies configured ignoreRegions masks and this test proves masked pixels do not contribute to mismatchRatio]"
  );
});
