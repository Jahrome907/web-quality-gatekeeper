import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";

const { mockPixelmatch } = vi.hoisted(() => ({
  mockPixelmatch: vi.fn((..._args: unknown[]) => 0)
}));

vi.mock("pixelmatch", () => ({
  default: mockPixelmatch
}));

import { runVisualDiff } from "../src/runner/visualDiff.js";

async function writePng(filePath: string, png: PNG): Promise<void> {
  const buffer = PNG.sync.write(png);
  await writeFile(filePath, buffer);
}

async function createWorkspace() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-visual-options-"));
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

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

describe("runVisualDiff pixelmatch options", () => {
  beforeEach(() => {
    mockPixelmatch.mockClear();
  });

  it("forwards includeAA and threshold from config", async () => {
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

    try {
      await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        1,
        logger,
        {
          pixelmatch: {
            includeAA: true,
            threshold: 0.42
          }
        }
      );

      expect(mockPixelmatch).toHaveBeenCalledTimes(1);
      expect(mockPixelmatch.mock.calls[0]?.[5]).toEqual({ includeAA: true, threshold: 0.42 });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses default pixelmatch options when config is omitted", async () => {
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

    try {
      await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        1,
        logger
      );

      expect(mockPixelmatch).toHaveBeenCalledTimes(1);
      expect(mockPixelmatch.mock.calls[0]?.[5]).toEqual({ includeAA: false, threshold: 0.1 });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
