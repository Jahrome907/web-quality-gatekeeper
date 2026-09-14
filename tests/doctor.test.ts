import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsBrowserExecutableFile, mockResolveBrowserExecutablePath } = vi.hoisted(() => ({
  mockIsBrowserExecutableFile: vi.fn(),
  mockResolveBrowserExecutablePath: vi.fn()
}));

vi.mock("../src/utils/browserExecutable.js", () => ({
  isBrowserExecutableFile: mockIsBrowserExecutableFile,
  resolveBrowserExecutablePath: mockResolveBrowserExecutablePath
}));
import { formatDoctorText, runDoctor, satisfiesMinimumNode } from "../src/doctor.js";

describe("doctor diagnostics", () => {
  beforeEach(() => {
    mockIsBrowserExecutableFile.mockReturnValue(false);
    mockResolveBrowserExecutablePath.mockReturnValue(undefined);
  });
  it("checks Node.js against the package engine floor", () => {
    expect(satisfiesMinimumNode("22.19.0", ">=22.19.0")).toBe(true);
    expect(satisfiesMinimumNode("22.19.0", ">=22.19")).toBe(true);
    expect(satisfiesMinimumNode("24.0.0", ">=22.19.0")).toBe(true);
    expect(satisfiesMinimumNode("22.18.9", ">=22.19.0")).toBe(false);
  });

  it("reports pass or warning diagnostics for a valid local setup", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      browserProbe: async () => ({ ok: true, version: "Google Chrome 120.0.0.0" })
    });

    expect(result.status).toBe("pass");
    expect(result.checks.map((check) => check.id)).toEqual([
      "node",
      "config",
      "out",
      "baseline",
      "browser"
    ]);
    expect(result.checks.find((check) => check.id === "config")).toMatchObject({
      status: "pass"
    });
    expect(formatDoctorText(result)).toContain("Web Quality Gatekeeper doctor");
  }, 15000);

  it("rejects removed native environment requests before probing executables", async () => {
    await expect(
      runDoctor({
        config: "configs/default.json",
        out: "artifacts",
        baselineDir: "baselines",
        env: {
          ...process.env,
          CHROME_PATH: process.execPath,
          WQG_VISUAL_DIFF_ENGINE: "native-rust"
        },
        nodeVersion: "24.0.0"
      })
    ).rejects.toThrow('WQG_VISUAL_DIFF_ENGINE="native-rust" is no longer supported.');
    expect(mockIsBrowserExecutableFile).not.toHaveBeenCalled();
  });

  it("fails when config or output paths are unsafe", async () => {
    const result = await runDoctor({
      config: "missing.json",
      out: path.resolve("..", "outside-artifacts"),
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: path.join(process.cwd(), "missing-chrome") },
      nodeVersion: "20.0.0",
      playwrightChromiumPath: null
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.id === "node")).toMatchObject({
      status: "warn"
    });
    expect(result.checks.find((check) => check.id === "config")).toMatchObject({
      status: "fail"
    });
    expect(result.checks.find((check) => check.id === "out")).toMatchObject({
      status: "fail"
    });
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "fail"
    });
  });

  it("passes when standard system Chrome is available without CHROME_PATH or Playwright Chromium", async () => {
    mockResolveBrowserExecutablePath.mockReturnValue(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    );

    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: undefined },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: null
    });

    expect(result.status).toBe("pass");
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "pass",
      message: "System Chrome/Chromium browser was found and is available.",
      details: { chromePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" }
    });
  });
  it("warns or fails when CHROME_PATH points to a non-browser executable", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: null,
      browserProbe: async () => ({
        ok: false,
        message: "CHROME_PATH exists but does not identify as a Chrome/Chromium browser."
      })
    });

    expect(result.status).toBe("warn");
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "warn",
      message: "CHROME_PATH exists but does not identify as a Chrome/Chromium browser."
    });

    const strictResult = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: null,
      strict: true,
      browserProbe: async () => ({
        ok: false,
        message: "CHROME_PATH exists but does not identify as a Chrome/Chromium browser."
      })
    });

    expect(strictResult.status).toBe("fail");
    expect(strictResult.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "fail",
      message: "CHROME_PATH exists but does not identify as a Chrome/Chromium browser."
    });
  });

  it("accepts a CHROME_PATH recognized by the shared browser executable helper", async () => {
    mockIsBrowserExecutableFile.mockReturnValue(true);

    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: null
    });

    expect(result.status).toBe("pass");
    expect(mockIsBrowserExecutableFile).toHaveBeenCalledWith(process.execPath);
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "pass",
      message: "CHROME_PATH passed the browser executable probe.",
      details: { chromePath: process.execPath }
    });
  });

  it("keeps rejecting an unrecognized executable after the shared recognition check", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: null
    });

    expect(result.status).toBe("warn");
    expect(mockIsBrowserExecutableFile).toHaveBeenCalledWith(process.execPath);
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "warn",
      message: "CHROME_PATH exists but does not identify as a Chrome/Chromium browser."
    });
  });

  it("warns or fails when CHROME_PATH points to an existing directory", async () => {
    const chromePath = await mkdtemp(path.join(tmpdir(), "wqg-chrome-path-"));
    try {
      const result = await runDoctor({
        config: "configs/default.json",
        out: "artifacts",
        baselineDir: "baselines",
        env: { ...process.env, CHROME_PATH: chromePath },
        nodeVersion: "24.0.0",
        playwrightChromiumPath: process.execPath
      });

      expect(result.status).toBe("warn");
      expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
        status: "warn",
        message: "CHROME_PATH exists but is not a browser executable file."
      });

      const strictResult = await runDoctor({
        config: "configs/default.json",
        out: "artifacts",
        baselineDir: "baselines",
        env: { ...process.env, CHROME_PATH: chromePath },
        nodeVersion: "24.0.0",
        playwrightChromiumPath: process.execPath,
        strict: true
      });

      expect(strictResult.status).toBe("fail");
      expect(strictResult.checks.find((check) => check.id === "browser")).toMatchObject({
        status: "fail",
        message: "CHROME_PATH exists but is not a browser executable file."
      });
    } finally {
      await rm(chromePath, { recursive: true, force: true });
    }
  });

  it("warns on a stale CHROME_PATH when Playwright Chromium can be used instead", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: path.join(process.cwd(), "missing-chrome") },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: process.execPath
    });

    expect(result.status).toBe("warn");
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "warn",
      message:
        "CHROME_PATH is set but the file does not exist; Playwright Chromium is available as a fallback."
    });
  });
});
