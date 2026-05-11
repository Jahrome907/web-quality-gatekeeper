/* global process */
import http from "node:http";
import path from "node:path";
import { URL, fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const FIXTURE_DIR = path.join(ROOT, "tests", "fixtures", "site");
export const ACTION_PATH = path.join(ROOT, "action.yml");
export const STALE_REPO_ROOT_CLEANUP_AGE_MS = 60 * 60 * 1000;
const BUILD_LOCK_DIR = path.join(ROOT, ".tmp-build-lock");
const BUILD_LOCK_POLL_MS = 200;
const BUILD_LOCK_TIMEOUT_MS = 120000;
const REMOVE_RETRY_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM", "EACCES"]);

const LEAKED_PATH_PATTERNS = [
  /^C:\\Users\\.*\\AppData\\Local\\lighthouse\.\d+$/,
  /^\\\\wsl\.localhost\\.*\\lighthouse\.\d+$/,
  /^undefined:$/
];

function matchesLeakedPath(name) {
  return LEAKED_PATH_PATTERNS.some((pattern) => pattern.test(name));
}

function normalizeNewlines(source) {
  return source.replace(/\r\n/g, "\n");
}

function shouldUseShell(command) {
  if (process.platform !== "win32") {
    return false;
  }

  const extension = path.extname(command).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return true;
  }

  return command === "npm" || command === "npm.cmd" || command === "npx" || command === "npx.cmd";
}

function isRetryableRemoveError(error) {
  return error && typeof error === "object" && REMOVE_RETRY_CODES.has(error.code);
}

export async function removePathWithRetry(targetPath, options = {}) {
  const {
    recursive = true,
    force = true,
    maxAttempts = 6,
    baseDelayMs = 75,
    rmImpl = rm
  } = options;
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await rmImpl(targetPath, { recursive, force });
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRemoveError(error) || attempt === maxAttempts - 1) {
        break;
      }
      await delay(baseDelayMs * (attempt + 1));
    }
  }

  throw lastError;
}

export async function cleanupRepoRootNoise(options = {}) {
  const {
    root = ROOT,
    scratchPrefixes = [],
    staleAfterMs = STALE_REPO_ROOT_CLEANUP_AGE_MS
  } = options;
  const entries = await readdir(root, { withFileTypes: true });

  await Promise.all(
    entries
      .map(async (entry) => {
        if (!entry.isDirectory()) {
          return;
        }
        if (
          !scratchPrefixes.some((prefix) => entry.name.startsWith(prefix)) &&
          !matchesLeakedPath(entry.name)
        ) {
          return;
        }

        const entryPath = path.join(root, entry.name);
        const stats = await stat(entryPath).catch(() => null);
        if (!stats || Date.now() - stats.mtimeMs < staleAfterMs) {
          return;
        }

        await removePathWithRetry(entryPath);
      })
  );
}

export async function runChecked(command, args, options = {}) {
  const { env: optionEnv, timeout = 120000, shell, ...execOptions } = options;
  const effectiveShell = shell ?? shouldUseShell(command);

  try {
    return await execFileAsync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      timeout,
      shell: effectiveShell,
      env: {
        ...process.env,
        NO_COLOR: "1",
        ...optionEnv
      },
      ...execOptions
    });
  } catch (error) {
    const err = error;
    const stdout = typeof err.stdout === "string" ? err.stdout : "";
    const stderr = typeof err.stderr === "string" ? err.stderr : "";
    const details = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}${details ? `\n${details}` : ""}`,
      { cause: error }
    );
  }
}

function hasBuiltArtifacts() {
  return existsSync(path.join(ROOT, "dist", "cli.js")) && existsSync(path.join(ROOT, "dist", "index.js"));
}

async function acquireBuildLock(timeoutMs = BUILD_LOCK_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await mkdir(BUILD_LOCK_DIR);
      return;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        await new Promise((resolve) => globalThis.setTimeout(resolve, BUILD_LOCK_POLL_MS));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Timed out waiting for repo build lock at ${BUILD_LOCK_DIR}`);
}

export async function ensureRepoBuild() {
  if (hasBuiltArtifacts()) {
    return;
  }

  await acquireBuildLock();
  try {
    if (hasBuiltArtifacts()) {
      return;
    }
    await runChecked("npm", ["run", "build"]);
  } finally {
    await removePathWithRetry(BUILD_LOCK_DIR);
  }
}

export function readActionRunBlock() {
  const source = normalizeNewlines(readFileSync(ACTION_PATH, "utf8"));
  const stepIndex = source.indexOf("- name: Run audit");
  const runMarker = "      run: |\n";

  if (stepIndex === -1) {
    throw new Error("Failed to extract composite action run block from action.yml.");
  }
  const runIndex = source.indexOf(runMarker, stepIndex);
  if (runIndex === -1) {
    throw new Error("Failed to locate composite action run block marker in action.yml.");
  }

  return source
    .slice(runIndex + runMarker.length)
    .split("\n")
    .map((line) => (line.startsWith("        ") ? line.slice(8) : line))
    .join("\n")
    .trimEnd();
}

export function startFixtureServer(directory = FIXTURE_DIR, options = {}) {
  const { port = 0 } = options;
  return new Promise((resolve, reject) => {
    const fixtureRoot = path.resolve(directory);
    const server = http.createServer((req, res) => {
      const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
      const filePath = path.resolve(fixtureRoot, relativePath);
      const relativeToFixture = path.relative(fixtureRoot, filePath);

      if (relativeToFixture.startsWith("..") || path.isAbsolute(relativeToFixture)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }

      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath);
      const contentType = ext === ".html" ? "text/html" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(readFileSync(filePath));
    });

    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve fixture server address."));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
}

export function closeFixtureServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
