/* global console, process */
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { ROOT, cleanupRepoRootNoise, closeFixtureServer, runChecked, startFixtureServer } from "./_shared.mjs";

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
    await runChecked("npm", ["run", "build"]);
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
    await runChecked("npm", ["install", tarballPath, "--ignore-scripts"], {
      cwd: consumerDir
    });
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
      { cwd: consumerDir }
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
    await rm(smokeRoot, { recursive: true, force: true });
  }
}

runPackSmoke();
