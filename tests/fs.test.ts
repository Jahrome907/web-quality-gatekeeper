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
      "Output directory must be within the working directory"
    );
  });

  it("rejects deeply nested traversal", () => {
    expect(() => validateOutputDirectory("../../etc")).toThrow(
      "Output directory must be within the working directory"
    );
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
