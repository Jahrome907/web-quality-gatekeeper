import { describe, expect, it, vi } from "vitest";

describe("trusted publish runtime preflight", () => {
  it("uses npm.cmd on Windows", async () => {
    const { resolveNpmCommand } = await import("../scripts/ci/assert-publish-runtime.mjs");

    expect(resolveNpmCommand("win32")).toBe("npm.cmd");
    expect(resolveNpmCommand("linux")).toBe("npm");
  });

  it("accepts an injected npm executor for version checks", async () => {
    const { main } = await import("../scripts/ci/assert-publish-runtime.mjs");
    const execFileSync = vi.fn().mockReturnValue("11.7.0\n");

    expect(() => main({ platform: "win32", nodeVersion: "24.0.0", execFileSync })).not.toThrow();
    expect(execFileSync).toHaveBeenCalledWith("npm.cmd", ["--version"], {
      encoding: "utf8"
    });
  });
});
