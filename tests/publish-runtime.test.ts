import { describe, expect, it, vi } from "vitest";

describe("trusted publish runtime preflight", () => {
  it("uses the Windows command processor for npm.cmd shims", async () => {
    const { resolveNpmInvocation } = await import("../scripts/ci/assert-publish-runtime.mjs");

    expect(
      resolveNpmInvocation("win32", {
        npmExecPath: "",
        commandProcessor: "C:\\Windows\\System32\\cmd.exe"
      })
    ).toEqual({
      file: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd --version"]
    });
    expect(resolveNpmInvocation("linux", { npmExecPath: "" })).toEqual({
      file: "npm",
      args: ["--version"]
    });
  });

  it("prefers the npm lifecycle CLI path when available", async () => {
    const { resolveNpmInvocation } = await import("../scripts/ci/assert-publish-runtime.mjs");

    expect(
      resolveNpmInvocation("win32", {
        npmExecPath: "C:\\npm\\npm-cli.js",
        nodeExecPath: "C:\\node\\node.exe"
      })
    ).toEqual({
      file: "C:\\node\\node.exe",
      args: ["C:\\npm\\npm-cli.js", "--version"]
    });
  });

  it("accepts an injected npm executor for version checks", async () => {
    const { main } = await import("../scripts/ci/assert-publish-runtime.mjs");
    const execFileSync = vi.fn().mockReturnValue("11.7.0\n");

    expect(() =>
      main({
        platform: "win32",
        nodeVersion: "24.0.0",
        npmExecPath: "",
        commandProcessor: "cmd.exe",
        execFileSync
      })
    ).not.toThrow();
    expect(execFileSync).toHaveBeenCalledWith("cmd.exe", ["/d", "/s", "/c", "npm.cmd --version"], {
      encoding: "utf8"
    });
  });

  it.runIf(process.platform === "win32")(
    "executes the installed npm.cmd shim without spawn EINVAL",
    async () => {
      const { execFileSync } = await import("node:child_process");
      const { resolveNpmInvocation } = await import("../scripts/ci/assert-publish-runtime.mjs");
      const invocation = resolveNpmInvocation("win32", { npmExecPath: "" });

      expect(execFileSync(invocation.file, invocation.args, { encoding: "utf8" }).trim()).toMatch(
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
      );
    }
  );
});
