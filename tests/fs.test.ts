import { describe, expect, it } from "vitest";
import { validateOutputDirectory, validatePathWithinBase } from "../src/utils/fs.js";

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
