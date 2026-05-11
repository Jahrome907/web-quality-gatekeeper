/* global console, process */
import path from "node:path";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rename, symlink, writeFile } from "node:fs/promises";
import {
  ROOT,
  cleanupRepoRootNoise,
  closeFixtureServer,
  ensureRepoBuild,
  removePathWithRetry,
  runChecked,
  startFixtureServer
} from "./_shared.mjs";

function assertTarballEntries(tarballEntries) {
  const requiredEntries = [
    "package/dist/cli.js",
    "package/dist/index.js",
    "package/schemas/summary.v1.json",
    "package/schemas/summary.v2.json",
    "package/configs/default.json",
    "package/configs/policies/docs.json",
    "package/README.md",
    "package/LICENSE"
  ];

  for (const entry of requiredEntries) {
    if (!tarballEntries.includes(entry)) {
      throw new Error(`Expected tarball entry to exist: ${entry}`);
    }
  }

  for (const forbiddenPrefix of [
    "package/native/",
    "package/benchmarks/",
    "package/tools/",
    "package/tests/",
    "package/.github/",
    "package/artifacts/"
  ]) {
    if (tarballEntries.some((entry) => entry.startsWith(forbiddenPrefix))) {
      throw new Error(`Unexpected tarball entry under ${forbiddenPrefix}`);
    }
  }
}

async function runPackSmoke() {
  await cleanupRepoRootNoise({ scratchPrefixes: [".tmp-pack-smoke-", ".tmp-pack-debug-"] });
  const smokeRoot = await mkdtemp(path.join(ROOT, ".tmp-pack-smoke-"));
  const consumerDir = path.join(smokeRoot, "consumer");
  const packageRoot = path.join(consumerDir, "node_modules", "web-quality-gatekeeper");
  const outDir = path.join(consumerDir, "artifacts");
  const baselineDir = path.join(consumerDir, "baselines");
  const configPath = path.join(consumerDir, "consumer-config.json");
  let fixtureServer = null;

  try {
    await ensureRepoBuild();
    const { stdout: tarballStdout } = await runChecked("npm", [
      "pack",
      "--silent",
      "--pack-destination",
      smokeRoot
    ]);
    const tarballName = tarballStdout.trim();
    const tarballPath = path.join(smokeRoot, tarballName);
    const { stdout: tarballList } = await runChecked("tar", ["-tf", tarballPath]);
    assertTarballEntries(
      tarballList
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    );

    await mkdir(consumerDir, { recursive: true });
    await runChecked("npm", ["init", "-y"], { cwd: consumerDir });
    await installTarballWithRetry(consumerDir, tarballPath);
    // The consumer install intentionally skips package scripts, so provision the Playwright browser explicitly.
    await runChecked("npx", ["playwright", "install", "chromium"], {
      cwd: consumerDir,
      timeout: 600000
    });

    const installedWqgBin =
      process.platform === "win32"
        ? path.join(consumerDir, "node_modules", ".bin", "wqg.cmd")
        : path.join(consumerDir, "node_modules", ".bin", "wqg");
    const { stdout: versionStdout } = await runChecked(installedWqgBin, ["--version"], {
      cwd: consumerDir
    });
    const installedPackage = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (versionStdout.trim() !== installedPackage.version) {
      throw new Error(
        `Expected packaged wqg binary version (${versionStdout.trim()}) to match package.json (${installedPackage.version})`
      );
    }

    await runChecked(installedWqgBin, ["init", "--profile", "docs"], {
      cwd: consumerDir
    });
    for (const scaffoldedPath of [
      path.join(consumerDir, ".github", "web-quality", "config.json"),
      path.join(consumerDir, ".github", "workflows", "web-quality.yml"),
      path.join(consumerDir, ".github", "web-quality", "baselines", ".gitkeep"),
      path.join(consumerDir, ".github", "web-quality", "README.md")
    ]) {
      if (!existsSync(scaffoldedPath)) {
        throw new Error(`Expected wqg init to create ${scaffoldedPath}`);
      }
    }
    const scaffoldedConfig = JSON.parse(
      await readFile(path.join(consumerDir, ".github", "web-quality", "config.json"), "utf8")
    );
    if (scaffoldedConfig.extends?.[0] !== "policy:docs") {
      throw new Error("Expected wqg init --profile docs to scaffold the docs policy config.");
    }
    await expectCommandExit(installedWqgBin, ["init", "--profile", "invalid-profile"], 2, {
      cwd: consumerDir
    });
    await expectCommandExit(installedWqgBin, ["init", "--profile", "docs"], 1, {
      cwd: consumerDir
    });
    await runChecked(installedWqgBin, ["init", "--profile", "docs", "--force"], {
      cwd: consumerDir
    });

    await runChecked(
      "node",
      [
        "--input-type=module",
        "--eval",
        [
          'const pkg = await import("web-quality-gatekeeper");',
          'if (typeof pkg.runAudit !== "function") throw new Error("Missing runAudit export");',
          'if (typeof pkg.SCHEMA_VERSION !== "string") throw new Error("Missing SCHEMA_VERSION export");'
        ].join(" ")
      ],
      {
        cwd: consumerDir,
        shell: false
      }
    );

    for (const requiredPath of [
      path.join(packageRoot, "dist", "cli.js"),
      path.join(packageRoot, "dist", "index.js"),
      path.join(packageRoot, "schemas", "summary.v1.json"),
      path.join(packageRoot, "schemas", "summary.v2.json"),
      path.join(packageRoot, "configs", "default.json"),
      path.join(packageRoot, "configs", "policies", "docs.json"),
      path.join(packageRoot, "README.md"),
      path.join(packageRoot, "LICENSE")
    ]) {
      if (!existsSync(requiredPath)) {
        throw new Error(`Expected packaged asset to exist: ${requiredPath}`);
      }
    }

    await writeFile(
      configPath,
      JSON.stringify(
        {
          timeouts: {
            navigationMs: 15000,
            actionMs: 5000,
            waitAfterLoadMs: 250
          },
          playwright: {
            viewport: {
              width: 1280,
              height: 720
            },
            userAgent: "wqg-pack-smoke/1.0.0",
            locale: "en-US",
            colorScheme: "light"
          },
          screenshots: [{ name: "home", path: "/", fullPage: true }],
          lighthouse: {
            budgets: {
              performance: 0.8,
              lcpMs: 2500,
              cls: 0.1,
              tbtMs: 200
            },
            formFactor: "desktop"
          },
          visual: {
            threshold: 0.01
          },
          toggles: {
            a11y: false,
            perf: false,
            visual: false
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const fixture = await startFixtureServer();
    fixtureServer = fixture.server;

    await runChecked(
      installedWqgBin,
      [
        "audit",
        fixture.url,
        "--config",
        configPath,
        "--out",
        outDir,
        "--baseline-dir",
        baselineDir,
        "--allow-internal-targets",
        "--no-fail-on-a11y",
        "--no-fail-on-perf",
        "--no-fail-on-visual"
      ],
      {
        cwd: consumerDir,
        env: {
          CI: "false",
          GITHUB_ACTIONS: "false"
        }
      }
    );

    const summary = JSON.parse(await readFile(path.join(outDir, "summary.json"), "utf8"));
    const summaryV2 = JSON.parse(await readFile(path.join(outDir, "summary.v2.json"), "utf8"));
    const summarySchemaV1 = JSON.parse(await readFile(path.join(packageRoot, "schemas", "summary.v1.json"), "utf8"));
    const summarySchemaV2 = JSON.parse(await readFile(path.join(packageRoot, "schemas", "summary.v2.json"), "utf8"));
    if (summary.$schema !== summarySchemaV1.properties?.$schema?.const) {
      throw new Error("Expected emitted summary.json $schema to match packaged summary.v1 schema URI");
    }
    if (summaryV2.$schema !== summarySchemaV2.properties?.$schema?.const) {
      throw new Error("Expected emitted summary.v2.json $schema to match packaged summary.v2 schema URI");
    }
    if (summary.artifacts?.summary !== "summary.json") {
      throw new Error("Expected packaged summary artifact path to remain summary.json");
    }
    if (summaryV2.mode !== "single" || summaryV2.rollup?.pageCount !== 1) {
      throw new Error("Expected packaged summary.v2 output to preserve single-page rollup semantics");
    }
    if (summaryV2.schemaPointers?.v1 !== summary.$schema || summaryV2.schemaPointers?.v2 !== summaryV2.$schema) {
      throw new Error("Expected summary.v2 schemaPointers to align with emitted summary schema URIs");
    }
    if (
      summaryV2.schemaVersions?.v1 !== summary.schemaVersion ||
      summaryV2.schemaVersions?.v2 !== summaryV2.schemaVersion
    ) {
      throw new Error("Expected summary.v2 schemaVersions to align with emitted summary schema versions");
    }
    if (summaryV2.compatibility?.v1SummaryPath !== "summary.json") {
      throw new Error("Expected summary.v2 compatibility.v1SummaryPath to remain summary.json");
    }

    console.log("Pack smoke completed.");
  } finally {
    if (fixtureServer) {
      await closeFixtureServer(fixtureServer);
    }
    try {
      await removePathWithRetry(smokeRoot, {
        maxAttempts: 20,
        baseDelayMs: 250
      });
    } catch (error) {
      console.warn(
        `Warning: pack smoke completed but could not remove temporary directory ${smokeRoot}: ${(error && error.message) || error}`
      );
    }
  }
}

async function installTarballWithRetry(consumerDir, tarballPath) {
  const maxAttempts = 2;
  let lastError;

  if (shouldUseOfflinePackSmokeFallback()) {
    console.warn("Using offline tarball extraction for local Windows pack smoke; CI still runs npm install.");
    await installTarballByExtraction(consumerDir, tarballPath);
    return;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runChecked("npm", [
        "install",
        tarballPath,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund"
      ], {
        cwd: consumerDir,
        timeout: 300000
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      console.warn(`npm install failed during pack smoke; retrying clean install (${attempt}/${maxAttempts}).`);
      await Promise.all([
        removePathWithRetry(path.join(consumerDir, "node_modules")),
        removePathWithRetry(path.join(consumerDir, "package-lock.json"))
      ]);
    }
  }

  if (shouldUseOfflinePackSmokeFallback() && isNpmInternalExitHandlerError(lastError)) {
    console.warn("npm install failed with an npm CLI internal error; using offline tarball extraction fallback.");
    await installTarballByExtraction(consumerDir, tarballPath);
    return;
  }

  throw lastError;
}

function dependencyPath(root, name) {
  return path.join(root, "node_modules", ...name.split("/"));
}

function windowsBinShim(targetScript) {
  return `@ECHO off\r\nnode "%~dp0\\${targetScript}" %*\r\n`;
}

function posixBinShim(targetScript) {
  return `#!/usr/bin/env sh\nexec node "$(dirname "$0")/${targetScript}" "$@"\n`;
}

function isNpmInternalExitHandlerError(error) {
  const text = `${error?.message ?? ""}\n${error?.cause?.stderr ?? ""}`;
  return text.includes("Exit handler never called");
}

function shouldUseOfflinePackSmokeFallback() {
  return (
    process.platform === "win32" &&
    process.env.CI !== "true" &&
    process.env.WQG_PACK_SMOKE_FORCE_NPM_INSTALL !== "true"
  );
}

async function createPackageBin(binDir, packageName, packageRoot, binDefinition) {
  const entries =
    typeof binDefinition === "string"
      ? [[packageName.split("/").pop(), binDefinition]]
      : Object.entries(binDefinition ?? {});

  for (const [binName, relativeBinPath] of entries) {
    if (typeof binName !== "string" || typeof relativeBinPath !== "string") {
      continue;
    }
    const packageRelative = path.relative(binDir, path.join(packageRoot, relativeBinPath));
    const normalizedRelative = packageRelative.replaceAll(path.sep, "\\");
    const posixRelative = packageRelative.replaceAll(path.sep, "/");
    await writeFile(path.join(binDir, `${binName}.cmd`), windowsBinShim(normalizedRelative), "utf8");
    const posixShim = path.join(binDir, binName);
    await writeFile(posixShim, posixBinShim(posixRelative), "utf8");
    await chmod(posixShim, 0o755);
  }
}

async function installTarballByExtraction(consumerDir, tarballPath) {
  const nodeModulesDir = path.join(consumerDir, "node_modules");
  const binDir = path.join(nodeModulesDir, ".bin");
  const packageRoot = path.join(nodeModulesDir, "web-quality-gatekeeper");
  const stagingDir = path.join(consumerDir, ".tarball-extract");

  await removePathWithRetry(stagingDir);
  await mkdir(nodeModulesDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(stagingDir, { recursive: true });
  await runChecked("tar", ["-xf", tarballPath, "-C", stagingDir]);
  await removePathWithRetry(packageRoot);
  await rename(path.join(stagingDir, "package"), packageRoot);
  await removePathWithRetry(stagingDir);

  const installedPackage = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const dependencies = Object.keys(installedPackage.dependencies ?? {});
  for (const dependency of dependencies) {
    const source = dependencyPath(ROOT, dependency);
    const destination = dependencyPath(consumerDir, dependency);
    if (!existsSync(source)) {
      throw new Error(`Cannot create offline pack-smoke install; missing dependency ${dependency} at ${source}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    if (!existsSync(destination)) {
      await symlink(source, destination, process.platform === "win32" ? "junction" : "dir");
    }

    const dependencyPackage = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
    if (dependencyPackage.bin) {
      await createPackageBin(binDir, dependency, destination, dependencyPackage.bin);
    }
  }

  await createPackageBin(binDir, "wqg", packageRoot, installedPackage.bin);
}

async function expectCommandExit(command, args, expectedCode, options = {}) {
  try {
    await runChecked(command, args, options);
  } catch (error) {
    const actualCode = error?.cause?.code;
    if (actualCode === expectedCode) {
      return;
    }
    throw new Error(
      `Expected command to exit ${expectedCode}, got ${actualCode ?? "unknown"}: ${command} ${args.join(" ")}`,
      { cause: error }
    );
  }

  throw new Error(`Expected command to fail with exit ${expectedCode}: ${command} ${args.join(" ")}`);
}

runPackSmoke();
