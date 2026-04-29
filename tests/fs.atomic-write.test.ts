import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("atomic write failure behavior", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.doUnmock("node:timers/promises");
    vi.resetModules();
  });

  it("preserves the existing artifact when replacement rename retries fail", async () => {
    const originalFs = await vi.importActual<typeof FsPromises>("node:fs/promises");
    const rename = vi.fn(async () => {
      const error = new Error("destination is busy") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });
    const unlink = vi.fn(async (target: string | Buffer | URL) => originalFs.unlink(target));

    vi.doMock("node:fs/promises", () => ({
      ...originalFs,
      rename,
      unlink
    }));
    vi.doMock("node:timers/promises", () => ({
      setTimeout: vi.fn(async () => undefined)
    }));

    const workspace = await mkdtemp(path.join(tmpdir(), "wqg-fs-atomic-failure-"));
    const outputFile = path.join(workspace, "report.html");

    try {
      await writeFile(outputFile, "original", "utf8");

      const { writeText } = await import("../src/utils/fs.js");
      await expect(writeText(outputFile, "replacement")).rejects.toThrow("destination is busy");

      expect(rename).toHaveBeenCalledTimes(5);
      expect(unlink).not.toHaveBeenCalledWith(outputFile);
      await expect(readFile(outputFile, "utf8")).resolves.toBe("original");

      const entries = await readdir(workspace);
      expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
