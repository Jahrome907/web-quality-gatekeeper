import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { formatDoctorText, runDoctor, satisfiesMinimumNode } from "../src/doctor.js";

describe("doctor diagnostics", () => {
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
      env: { ...process.env, CHROME_PATH: undefined },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: process.execPath
    });

    expect(result.status).toBe("pass");
    expect(result.checks.map((check) => check.id)).toEqual([
      "node",
      "config",
      "native-visual-engine",
      "out",
      "baseline",
      "browser"
    ]);
    expect(result.checks.find((check) => check.id === "config")).toMatchObject({
      status: "pass"
    });
    expect(formatDoctorText(result)).toContain("Web Quality Gatekeeper doctor");
  }, 15000);

  it("fails strict diagnostics when a requested native engine cannot run", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      strict: true,
      env: {
        ...process.env,
        CHROME_PATH: undefined,
        WQG_VISUAL_DIFF_ENGINE: "native-rust"
      },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: process.execPath
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.id === "native-visual-engine")).toMatchObject({
      status: "fail",
      message:
        "Native visual diff engine is requested but no binary path is configured; audits will fall back to pixelmatch."
    });
  });

  it("warns when a native engine path points at a script adapter", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: {
        ...process.env,
        CHROME_PATH: undefined,
        WQG_VISUAL_DIFF_ENGINE: "native-rust",
        WQG_VISUAL_DIFF_NATIVE_BIN: path.join(
          process.cwd(),
          "scripts",
          "ci",
          "resolve-chrome-path.mjs"
        )
      },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: process.execPath
    });

    expect(result.status).toBe("warn");
    expect(result.checks.find((check) => check.id === "native-visual-engine")).toMatchObject({
      status: "warn",
      message:
        "Native visual diff engine points to a JavaScript adapter. Set WQG_ALLOW_SCRIPT_NATIVE_ENGINE=true only for trusted test adapters."
    });
  });

  it("warns when an existing native engine path fails the protocol probe", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "wqg-doctor-probe-"));

    try {
      const config = JSON.parse(
        await readFile(path.join(process.cwd(), "configs", "default.json"), "utf8")
      ) as {
        visual: {
          pixelmatch?: { includeAA?: boolean };
        };
      };
      config.visual.pixelmatch = { ...(config.visual.pixelmatch ?? {}), includeAA: true };
      await writeFile(path.join(cwd, "config.json"), JSON.stringify(config, null, 2), "utf8");

      const result = await runDoctor({
        config: path.join(cwd, "config.json"),
        out: "artifacts",
        baselineDir: "baselines",
        env: {
          ...process.env,
          CHROME_PATH: undefined,
          WQG_ALLOW_NATIVE_VISUAL_ENGINE: "true",
          WQG_VISUAL_DIFF_ENGINE: "native-rust",
          WQG_VISUAL_DIFF_NATIVE_BIN: process.execPath
        },
        nodeVersion: "24.0.0",
        playwrightChromiumPath: process.execPath
      });

      expect(result.status).toBe("warn");
      expect(result.checks.find((check) => check.id === "native-visual-engine")).toMatchObject({
        status: "warn",
        message:
          "Native visual diff engine failed the health probe; audits will fall back to pixelmatch."
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("lets WQG_VISUAL_DIFF_NATIVE_BIN override stale config native paths", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "wqg-doctor-native-env-"));

    try {
      const config = JSON.parse(
        await readFile(path.join(process.cwd(), "configs", "default.json"), "utf8")
      ) as {
        visual: {
          nativeBinaryPath?: string;
          engine?: string;
          pixelmatch?: { includeAA?: boolean };
        };
      };
      config.visual.engine = "native-rust";
      config.visual.nativeBinaryPath = path.join(cwd, "missing-native-bin");
      config.visual.pixelmatch = { ...(config.visual.pixelmatch ?? {}), includeAA: true };
      await writeFile(path.join(cwd, "config.json"), JSON.stringify(config, null, 2), "utf8");
      const stubPath = path.join(cwd, "native-engine-stub.mjs");
      await writeFile(
        stubPath,
        `import { writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
function readFlag(flag) {
  const index = args.indexOf(flag);
  return args[index + 1];
}
await writeFile(readFlag("--diff-out"), Buffer.alloc(4));
process.stdout.write(JSON.stringify({ diffPixels: 0 }));
`,
        "utf8"
      );

      const originalCwd = process.cwd();
      process.chdir(cwd);
      try {
        const result = await runDoctor({
          config: "config.json",
          out: "artifacts",
          baselineDir: "baselines",
          env: {
            ...process.env,
            CHROME_PATH: undefined,
            WQG_ALLOW_NATIVE_VISUAL_ENGINE: "true",
            WQG_ALLOW_SCRIPT_NATIVE_ENGINE: "true",
            WQG_VISUAL_DIFF_NATIVE_BIN: stubPath
          },
          nodeVersion: "24.0.0",
          playwrightChromiumPath: process.execPath
        });

        expect(result.checks.find((check) => check.id === "native-visual-engine")).toMatchObject({
          status: "pass",
          details: { binaryPath: stubPath }
        });
      } finally {
        process.chdir(originalCwd);
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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

  it("warns when CHROME_PATH exists but does not launch as a browser", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: process.execPath
    });

    expect(result.status).toBe("warn");
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "warn",
      message:
        "CHROME_PATH exists but did not identify itself as a browser executable. Playwright Chromium is available as a fallback."
    });
  });

  it("fails strict diagnostics when CHROME_PATH exists but is not launchable as a browser", async () => {
    const result = await runDoctor({
      config: "configs/default.json",
      out: "artifacts",
      baselineDir: "baselines",
      strict: true,
      env: { ...process.env, CHROME_PATH: process.execPath },
      nodeVersion: "24.0.0",
      playwrightChromiumPath: null
    });

    expect(result.status).toBe("fail");
    expect(result.checks.find((check) => check.id === "browser")).toMatchObject({
      status: "fail",
      message: "CHROME_PATH exists but did not identify itself as a browser executable."
    });
  });
});
