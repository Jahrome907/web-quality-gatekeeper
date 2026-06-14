import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { runVisualDiff } from "../src/runner/visualDiff.js";

function setPixel(png: PNG, x: number, y: number, rgba: [number, number, number, number]) {
  const idx = (png.width * y + x) * 4;
  png.data[idx] = rgba[0];
  png.data[idx + 1] = rgba[1];
  png.data[idx + 2] = rgba[2];
  png.data[idx + 3] = rgba[3];
}

async function writePng(filePath: string, png: PNG): Promise<void> {
  const buffer = PNG.sync.write(png);
  await writeFile(filePath, buffer);
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
}

function allowNativeEngineInCi(): () => void {
  const originalAllowNative = process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
  const originalAllowScriptNative = process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;
  process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = "true";
  process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE = "true";
  return () => {
    if (originalAllowNative === undefined) {
      delete process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
    } else {
      process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = originalAllowNative;
    }
    if (originalAllowScriptNative === undefined) {
      delete process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;
    } else {
      process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE = originalAllowScriptNative;
    }
  };
}

async function createWorkspace() {
  const tempDir = await mkdtemp(path.join(tmpdir(), "wqg-visual-native-"));
  const baselineDir = path.join(tempDir, "baselines");
  const diffDir = path.join(tempDir, "diffs");
  const currentDir = path.join(tempDir, "screenshots");

  await Promise.all([
    mkdir(baselineDir, { recursive: true }),
    mkdir(diffDir, { recursive: true }),
    mkdir(currentDir, { recursive: true })
  ]);

  return { tempDir, baselineDir, diffDir, currentDir };
}

async function createNativeEngineStub(tempDir: string): Promise<string> {
  const stubPath = path.join(tempDir, "native-engine-stub.mjs");
  const source = `#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
function readFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    throw new Error(\`Missing value for \${flag}\`);
  }
  return args[index + 1];
}

const width = Number.parseInt(readFlag("--width"), 10);
const height = Number.parseInt(readFlag("--height"), 10);
const baselinePath = readFlag("--baseline");
const currentPath = readFlag("--current");
const diffPath = readFlag("--diff-out");
const threshold = Number.parseFloat(readFlag("--threshold"));

const [baseline, current] = await Promise.all([readFile(baselinePath), readFile(currentPath)]);
const diff = Buffer.alloc(width * height * 4);
let diffPixels = 0;
const limit = Math.round(Math.max(0, threshold) * 255);

for (let index = 0; index < baseline.length; index += 4) {
  const maxDelta = Math.max(
    Math.abs(baseline[index] - current[index]),
    Math.abs(baseline[index + 1] - current[index + 1]),
    Math.abs(baseline[index + 2] - current[index + 2]),
    Math.abs(baseline[index + 3] - current[index + 3]),
  );
  if (maxDelta > limit) {
    diff[index] = 255;
    diff[index + 1] = 0;
    diff[index + 2] = 0;
    diff[index + 3] = 255;
    diffPixels += 1;
  }
}

await writeFile(diffPath, diff);
process.stdout.write(JSON.stringify({ diffPixels }));
`;

  await writeFile(stubPath, source, "utf8");
  await chmod(stubPath, 0o755);
  return stubPath;
}

async function createHangingNativeEngineStub(tempDir: string): Promise<string> {
  const stubPath = path.join(tempDir, "native-engine-hang-stub.mjs");
  const source = `#!/usr/bin/env node
setTimeout(() => {}, 60000);
`;

  await writeFile(stubPath, source, "utf8");
  await chmod(stubPath, 0o755);
  return stubPath;
}

async function createMalformedNativeEngineStub(
  tempDir: string,
  mode: "bad-json" | "negative-diff" | "short-diff"
): Promise<string> {
  const stubPath = path.join(tempDir, `native-engine-${mode}-stub.mjs`);
  const source = `#!/usr/bin/env node
import { writeFile } from "node:fs/promises";

const mode = ${JSON.stringify(mode)};
const args = process.argv.slice(2);
function readFlag(flag) {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    throw new Error(\`Missing value for \${flag}\`);
  }
  return args[index + 1];
}

const width = Number.parseInt(readFlag("--width"), 10);
const height = Number.parseInt(readFlag("--height"), 10);
const diffPath = readFlag("--diff-out");

if (mode === "bad-json") {
  await writeFile(diffPath, Buffer.alloc(width * height * 4));
  process.stdout.write("not-json");
} else if (mode === "negative-diff") {
  await writeFile(diffPath, Buffer.alloc(width * height * 4));
  process.stdout.write(JSON.stringify({ diffPixels: -1 }));
} else {
  await writeFile(diffPath, Buffer.alloc(1));
  process.stdout.write(JSON.stringify({ diffPixels: 0 }));
}
`;

  await writeFile(stubPath, source, "utf8");
  await chmod(stubPath, 0o755);
  return stubPath;
}

describe("runVisualDiff native engine", () => {
  it("keeps the pixelmatch checkerboard alpha reference case for semi-transparent pixels", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const baselinePath = path.join(baselineDir, "alpha-edge.png");
    const currentPath = path.join(currentDir, "alpha-edge.png");
    const baseline = new PNG({ width: 1, height: 1 });
    const current = new PNG({ width: 1, height: 1 });
    setPixel(baseline, 0, 0, [0, 50, 200, 0]);
    setPixel(current, 0, 0, [0, 100, 20, 17]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "alpha edge", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        1,
        logger,
        { pixelmatch: { includeAA: true, threshold: 0.02 } }
      );

      expect(summary.failed).toBe(false);
      expect(summary.results[0]?.mismatchRatio).toBe(0);
      expect(summary.results[0]?.engine).toBe("pixelmatch");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to pixelmatch when the native engine binary is missing", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath: path.join(tempDir, "missing-bin") }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine requested but no executable was provided; falling back to pixelmatch."
      );
    } finally {
      restoreNativeAllowance();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses JavaScript native adapters unless the test-only opt-in is set", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const originalAllowNative = process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
    const originalAllowScriptNative = process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const markerPath = path.join(tempDir, "script-executed.txt");
    const scriptPath = path.join(tempDir, "native-engine-poc.mjs");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    await writeFile(
      scriptPath,
      `import { writeFile } from "node:fs/promises";\nawait writeFile(${JSON.stringify(markerPath)}, "executed");\nprocess.stdout.write(JSON.stringify({ diffPixels: 0 }));\n`,
      "utf8"
    );
    await chmod(scriptPath, 0o755);
    process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = "true";
    delete process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath: scriptPath }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(existsSync(markerPath)).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine path appears to be a JavaScript adapter; set WQG_ALLOW_SCRIPT_NATIVE_ENGINE=true only for trusted test adapters. Falling back to pixelmatch."
      );
    } finally {
      if (originalAllowNative === undefined) {
        delete process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
      } else {
        process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = originalAllowNative;
      }
      if (originalAllowScriptNative === undefined) {
        delete process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;
      } else {
        process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE = originalAllowScriptNative;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses shebang script adapters unless the test-only opt-in is set", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const originalAllowNative = process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
    const originalAllowScriptNative = process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const scriptPath = path.join(tempDir, "native-engine-wrapper");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    await writeFile(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(scriptPath, 0o755);
    process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = "true";
    delete process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath: scriptPath }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(summary.results[0]?.engine).toBe("pixelmatch");
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine path appears to be a shell, batch, PowerShell, or shebang script; use a reviewed native binary or a JavaScript test adapter. Falling back to pixelmatch."
      );
    } finally {
      if (originalAllowNative === undefined) {
        delete process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
      } else {
        process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = originalAllowNative;
      }
      if (originalAllowScriptNative === undefined) {
        delete process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE;
      } else {
        process.env.WQG_ALLOW_SCRIPT_NATIVE_ENGINE = originalAllowScriptNative;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("refuses shell script adapters even when JavaScript test adapters are allowed", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const markerPath = path.join(tempDir, "shell-executed.txt");
    const scriptPath = path.join(tempDir, "native-engine-wrapper.sh");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    await writeFile(scriptPath, `#!/bin/sh\ntouch ${JSON.stringify(markerPath)}\n`, "utf8");
    await chmod(scriptPath, 0o755);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath: scriptPath }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(summary.results[0]?.engine).toBe("pixelmatch");
      expect(existsSync(markerPath)).toBe(false);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine path appears to be a shell, batch, PowerShell, or shebang script; use a reviewed native binary or a JavaScript test adapter. Falling back to pixelmatch."
      );
    } finally {
      restoreNativeAllowance();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses the native engine when an executable is supplied", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createNativeEngineStub(tempDir);
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath, pixelmatch: { includeAA: true } }
      );

      expect(summary.failed).toBe(true);
      expect(summary.maxMismatchRatio).toBe(0.25);
      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(summary.results[0]?.engine).toBe("native-rust");
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      restoreNativeAllowance();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lets WQG_VISUAL_DIFF_NATIVE_BIN override a stale configured binary path", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createNativeEngineStub(tempDir);
    const originalNativeBin = process.env.WQG_VISUAL_DIFF_NATIVE_BIN;
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    process.env.WQG_VISUAL_DIFF_NATIVE_BIN = nativeBinaryPath;

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        {
          engine: "native-rust",
          nativeBinaryPath: path.join(tempDir, "stale-configured-bin"),
          pixelmatch: { includeAA: true }
        }
      );

      expect(summary.results[0]?.engine).toBe("native-rust");
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      restoreNativeAllowance();
      if (originalNativeBin === undefined) {
        delete process.env.WQG_VISUAL_DIFF_NATIVE_BIN;
      } else {
        process.env.WQG_VISUAL_DIFF_NATIVE_BIN = originalNativeBin;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("lets WQG_VISUAL_DIFF_ENGINE enable native execution without config engine changes", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createNativeEngineStub(tempDir);
    const originalEngine = process.env.WQG_VISUAL_DIFF_ENGINE;
    const originalNativeBin = process.env.WQG_VISUAL_DIFF_NATIVE_BIN;
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    process.env.WQG_VISUAL_DIFF_ENGINE = "native-rust";
    process.env.WQG_VISUAL_DIFF_NATIVE_BIN = nativeBinaryPath;

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { pixelmatch: { includeAA: true } }
      );

      expect(summary.results[0]?.engine).toBe("native-rust");
      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      restoreNativeAllowance();
      if (originalEngine === undefined) {
        delete process.env.WQG_VISUAL_DIFF_ENGINE;
      } else {
        process.env.WQG_VISUAL_DIFF_ENGINE = originalEngine;
      }
      if (originalNativeBin === undefined) {
        delete process.env.WQG_VISUAL_DIFF_NATIVE_BIN;
      } else {
        process.env.WQG_VISUAL_DIFF_NATIVE_BIN = originalNativeBin;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not execute the native engine in CI unless explicitly allowed", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createNativeEngineStub(tempDir);
    const originalCi = process.env.CI;
    const originalAllowNative = process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    process.env.CI = "true";
    delete process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(summary.results[0]?.engine).toBe("pixelmatch");
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine is disabled in CI unless WQG_ALLOW_NATIVE_VISUAL_ENGINE=true; falling back to pixelmatch."
      );
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
      if (originalAllowNative === undefined) {
        delete process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE;
      } else {
        process.env.WQG_ALLOW_NATIVE_VISUAL_ENGINE = originalAllowNative;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to pixelmatch when anti-aliased pixel suppression is requested", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createNativeEngineStub(tempDir);
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine does not support anti-aliased pixel suppression yet; set visual.pixelmatch.includeAA=true only when that parity tradeoff is acceptable. Falling back to pixelmatch."
      );
    } finally {
      restoreNativeAllowance();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["bad-json", "Unexpected token"] as const,
    ["negative-diff", "invalid diff pixel count"] as const,
    ["short-diff", "diff bytes"] as const
  ])("falls back to pixelmatch when the native engine returns %s output", async (mode, warning) => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createMalformedNativeEngineStub(tempDir, mode);
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath, pixelmatch: { includeAA: true } }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Native visual diff engine failed; falling back to pixelmatch.")
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(warning));
    } finally {
      restoreNativeAllowance();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to pixelmatch when the native engine times out", async () => {
    const { tempDir, baselineDir, diffDir, currentDir } = await createWorkspace();
    const logger = createLogger();
    const nativeBinaryPath = await createHangingNativeEngineStub(tempDir);
    const originalTimeout = process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS;
    const restoreNativeAllowance = allowNativeEngineInCi();

    const baselinePath = path.join(baselineDir, "home.png");
    const currentPath = path.join(currentDir, "home.png");
    const baseline = new PNG({ width: 2, height: 2 });
    const current = new PNG({ width: 2, height: 2 });
    baseline.data.fill(255);
    current.data.fill(255);
    setPixel(current, 0, 0, [0, 0, 0, 255]);

    await writePng(baselinePath, baseline);
    await writePng(currentPath, current);
    process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS = "50";

    try {
      const summary = await runVisualDiff(
        [{ name: "home", path: currentPath, url: "https://example.com", fullPage: true }],
        baselineDir,
        diffDir,
        false,
        0,
        logger,
        { engine: "native-rust", nativeBinaryPath, pixelmatch: { includeAA: true } }
      );

      expect(summary.results[0]?.mismatchRatio).toBe(0.25);
      expect(logger.warn).toHaveBeenCalledWith(
        "Native visual diff engine failed; falling back to pixelmatch. Timed out after 50ms."
      );
    } finally {
      restoreNativeAllowance();
      if (originalTimeout === undefined) {
        delete process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS;
      } else {
        process.env.WQG_VISUAL_DIFF_NATIVE_TIMEOUT_MS = originalTimeout;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
