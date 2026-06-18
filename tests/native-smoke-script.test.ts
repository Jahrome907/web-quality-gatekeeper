import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNativeSmokeBinaryPath,
  classifyNativeSmokeBinaryPath
} from "../scripts/ci/native-visual-diff-smoke.mjs";

describe("native visual diff smoke binary validation", () => {
  it("classifies extensionless non-script paths as native binaries", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-native-smoke-test-"));
    const binaryPath = path.join(tempDir, "wqg-native");

    try {
      await writeFile(binaryPath, Buffer.from([0x4d, 0x5a, 0, 0]));
      await chmod(binaryPath, 0o755);

      expect(classifyNativeSmokeBinaryPath(binaryPath)).toBe("native");
      expect(() => assertNativeSmokeBinaryPath(binaryPath)).not.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses JavaScript adapter paths", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-native-smoke-test-"));
    const adapterPath = path.join(tempDir, "adapter.mjs");

    try {
      await writeFile(adapterPath, "process.exit(0);\n", "utf8");

      expect(classifyNativeSmokeBinaryPath(adapterPath)).toBe("javascript-adapter");
      expect(() => assertNativeSmokeBinaryPath(adapterPath)).toThrow(
        "Native visual diff smoke requires a reviewed native binary; JavaScript adapter paths are not allowed."
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses shebang script wrappers", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-native-smoke-test-"));
    const scriptPath = path.join(tempDir, "native-wrapper");

    try {
      await writeFile(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
      await chmod(scriptPath, 0o755);

      expect(classifyNativeSmokeBinaryPath(scriptPath)).toBe("script");
      expect(() => assertNativeSmokeBinaryPath(scriptPath)).toThrow(
        "Native visual diff smoke requires a reviewed native binary; shell, batch, PowerShell, and shebang script paths are not allowed."
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
