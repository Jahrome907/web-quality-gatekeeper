import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const scriptUrl = pathToFileURL(
  path.join(process.cwd(), "scripts", "enforce-runtime-audit.mjs")
).href;
const { auditScopeLabel, buildAuditCommand } = (await import(scriptUrl)) as {
  auditScopeLabel: (includeDev: boolean) => string;
  buildAuditCommand: (options: {
    includeDev: boolean;
    npmExecPath?: string;
    platform?: NodeJS.Platform | string;
  }) => { file: string; args: string[] };
};

describe("runtime audit gate script", () => {
  it("omits dev dependencies for runtime audit mode", () => {
    const command = buildAuditCommand({ includeDev: false, platform: "linux" });

    expect(command).toEqual({
      file: "npm",
      args: ["audit", "--omit=dev", "--json"]
    });
    expect(auditScopeLabel(false)).toBe("Runtime audit");
  });

  it("includes dev dependencies for toolchain audit mode", () => {
    const command = buildAuditCommand({ includeDev: true, platform: "linux" });

    expect(command).toEqual({
      file: "npm",
      args: ["audit", "--json"]
    });
    expect(command.args).not.toContain("--omit=dev");
    expect(auditScopeLabel(true)).toBe("Toolchain audit");
  });

  it("routes through the current npm CLI entrypoint when npm_execpath is available", () => {
    const command = buildAuditCommand({
      includeDev: false,
      npmExecPath: "/tmp/npm-cli.js",
      platform: "win32"
    });

    expect(command.file).toBe(process.execPath);
    expect(command.args).toEqual(["/tmp/npm-cli.js", "audit", "--omit=dev", "--json"]);
  });
});
