import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateOutputDirectory,
  validatePathWithinBase,
  writeJson,
  writeText
} from "../src/utils/fs.js";

describe("validateOutputDirectory", () => {
  it("accepts path within cwd", () => {
    expect(() => validateOutputDirectory("artifacts")).not.toThrow();
  });

  it("accepts nested path within cwd", () => {
    expect(() => validateOutputDirectory("output/reports")).not.toThrow();
  });

  it("rejects path traversal with ../", () => {
    expect(() => validateOutputDirectory("../outside")).toThrow(
      "Output directory must be within the working directory or GITHUB_WORKSPACE"
    );
  });

  it("rejects deeply nested traversal", () => {
    expect(() => validateOutputDirectory("../../etc")).toThrow(
      "Output directory must be within the working directory or GITHUB_WORKSPACE"
    );
  });

  it("accepts path within GITHUB_WORKSPACE when set", () => {
    const previous = process.env.GITHUB_WORKSPACE;
    process.env.GITHUB_WORKSPACE = "/tmp/wqg-workspace";
    try {
      expect(() => validateOutputDirectory("/tmp/wqg-workspace/artifacts")).not.toThrow();
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_WORKSPACE;
      } else {
        process.env.GITHUB_WORKSPACE = previous;
      }
    }
  });
});

describe("validatePathWithinBase", () => {
  it("accepts valid subpath", () => {
    expect(() => validatePathWithinBase("/base/dir/file.txt", "/base/dir")).not.toThrow();
  });

  it("accepts nested subpath", () => {
    expect(() => validatePathWithinBase("/base/dir/sub/file.txt", "/base/dir")).not.toThrow();
  });

  it("rejects .. traversal", () => {
    expect(() => validatePathWithinBase("/base/dir/../outside/file.txt", "/base/dir")).toThrow(
      "Path traversal detected"
    );
  });

  it("rejects absolute path outside base", () => {
    expect(() => validatePathWithinBase("/etc/passwd", "/home/user")).toThrow(
      "Path traversal detected"
    );
  });
});

describe("atomic writes", () => {
  it("writeJson writes formatted JSON and does not leave temp files", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "wqg-fs-json-"));
    const outputFile = path.join(workspace, "nested", "summary.json");

    try {
      await writeJson(outputFile, { ok: true, count: 2 });

      const content = await readFile(outputFile, "utf8");
      expect(JSON.parse(content)).toEqual({ ok: true, count: 2 });
      expect(content).toContain('\n  "ok": true');

      const entries = await readdir(path.dirname(outputFile));
      expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("writeText replaces existing files and does not leave temp files", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "wqg-fs-text-"));
    const outputFile = path.join(workspace, "nested", "report.html");

    try {
      await writeText(outputFile, "first");
      await writeText(outputFile, "second");

      const content = await readFile(outputFile, "utf8");
      expect(content).toBe("second");

      const entries = await readdir(path.dirname(outputFile));
      expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
