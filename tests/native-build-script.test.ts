import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

async function loadNativeBuildHelpers(): Promise<{
  buildNativeVisualDiff: (options?: {
    cargo?: string;
    cwd?: string;
    spawnSyncImpl?: (
      command: string,
      args: string[],
      options: { cwd: string; shell: false; stdio: string }
    ) => { status?: number; error?: Error };
    stdio?: string;
  }) => void;
  resolveCargoCommand: (env?: Record<string, string | undefined>, platform?: string) => string;
}> {
  return import("../scripts/ci/native-visual-diff-build.mjs");
}

describe("native visual diff build script", () => {
  it("finds cargo in the default Windows rustup location", async () => {
    const { resolveCargoCommand } = await loadNativeBuildHelpers();
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-cargo-home-"));
    const cargoDir = path.join(tempDir, ".cargo", "bin");
    const cargoPath = path.join(cargoDir, "cargo.exe");

    await mkdir(cargoDir, { recursive: true });
    await writeFile(cargoPath, "");

    try {
      expect(
        resolveCargoCommand(
          {
            USERPROFILE: tempDir,
            Path: "",
            PATH: ""
          },
          "win32"
        )
      ).toBe(cargoPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lets maintainers override the cargo executable explicitly", async () => {
    const { resolveCargoCommand } = await loadNativeBuildHelpers();
    const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-cargo-bin-"));
    const cargoPath = path.join(tempDir, "cargo-custom.exe");

    await writeFile(cargoPath, "");

    try {
      expect(
        resolveCargoCommand(
          {
            WQG_CARGO_BIN: cargoPath,
            Path: "",
            PATH: ""
          },
          "win32"
        )
      ).toBe(cargoPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("runs a locked release build for the native visual diff crate", async () => {
    const { buildNativeVisualDiff } = await loadNativeBuildHelpers();
    const spawnSyncImpl = vi.fn().mockReturnValue({ status: 0 });

    buildNativeVisualDiff({
      cargo: "cargo-test",
      cwd: "C:\\repo",
      spawnSyncImpl,
      stdio: "pipe"
    });

    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "cargo-test",
      [
        "build",
        "--manifest-path",
        path.join("native", "wqg-visual-diff-native", "Cargo.toml"),
        "--release",
        "--locked"
      ],
      {
        cwd: "C:\\repo",
        shell: false,
        stdio: "pipe"
      }
    );
  });
});
