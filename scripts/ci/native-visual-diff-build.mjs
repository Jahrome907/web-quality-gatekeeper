/* global URL, console, process */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MANIFEST_PATH = path.join("native", "wqg-visual-diff-native", "Cargo.toml");

function cargoExecutableName(platform = process.platform) {
  return platform === "win32" ? "cargo.exe" : "cargo";
}

function pathEntries(env = process.env) {
  return String(env.Path ?? env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function cargoHomeCandidates(env = process.env, platform = process.platform) {
  const executable = cargoExecutableName(platform);
  const homes = [env.CARGO_HOME, env.USERPROFILE && path.join(env.USERPROFILE, ".cargo")];
  if (env.HOME) {
    homes.push(path.join(env.HOME, ".cargo"));
  }

  return homes
    .filter((candidate) => typeof candidate === "string" && candidate.trim().length > 0)
    .map((home) => path.join(home, "bin", executable));
}

export function resolveCargoCommand(env = process.env, platform = process.platform) {
  const configured = env.WQG_CARGO_BIN?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (!existsSync(resolved)) {
      throw new Error(`WQG_CARGO_BIN points to a missing cargo executable: ${resolved}`);
    }
    return resolved;
  }

  const executable = cargoExecutableName(platform);
  const pathCandidates = pathEntries(env).map((entry) => path.join(entry, executable));
  const candidates = [...pathCandidates, ...cargoHomeCandidates(env, platform)];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (resolved) {
    return resolved;
  }

  throw new Error(
    [
      "Unable to find cargo. Install Rust with rustup or set WQG_CARGO_BIN to the cargo executable.",
      platform === "win32"
        ? "On Windows, rustup usually installs cargo at %USERPROFILE%\\.cargo\\bin\\cargo.exe."
        : "rustup usually installs cargo at $HOME/.cargo/bin/cargo."
    ].join(" ")
  );
}

export function buildNativeVisualDiff(options = {}) {
  const {
    cargo = resolveCargoCommand(),
    spawnSyncImpl = spawnSync,
    cwd = ROOT,
    stdio = "inherit"
  } = options;
  const args = ["build", "--manifest-path", MANIFEST_PATH, "--release", "--locked"];
  const result = spawnSyncImpl(cargo, args, {
    cwd,
    stdio,
    shell: false
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`cargo build failed with exit ${result.status ?? "unknown"}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    buildNativeVisualDiff();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
