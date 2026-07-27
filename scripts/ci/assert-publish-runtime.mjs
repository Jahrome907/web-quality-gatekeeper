/* global console, process */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const MINIMUMS = {
  node: [22, 19, 0],
  npm: [11, 5, 1]
};

export function parseVersion(label, rawValue) {
  const match = rawValue.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`${label} version '${rawValue.trim()}' is not a supported semver string.`);
  }

  return match.slice(1).map((value) => Number.parseInt(value, 10));
}

export function isBelowMinimum(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) {
      return false;
    }
    if (actual[index] < minimum[index]) {
      return true;
    }
  }

  return false;
}

export function formatVersion(version) {
  return version.join(".");
}

export function assertMinimum(label, actual, minimum) {
  if (isBelowMinimum(actual, minimum)) {
    throw new Error(
      `Trusted publishing requires ${label} ${formatVersion(minimum)} or later (found ${formatVersion(actual)}).`
    );
  }
}

export function resolveNpmInvocation(platform = process.platform, options = {}) {
  const npmExecPath = Object.prototype.hasOwnProperty.call(options, "npmExecPath")
    ? options.npmExecPath
    : process.env.npm_execpath;

  if (npmExecPath) {
    return {
      file: options.nodeExecPath ?? process.execPath,
      args: [npmExecPath, "--version"]
    };
  }

  if (platform === "win32") {
    return {
      file: options.commandProcessor ?? process.env.ComSpec ?? "cmd.exe",
      // Node cannot execute .cmd shims directly. Keep the command literal so no
      // caller-controlled input crosses the command-processor boundary.
      args: ["/d", "/s", "/c", "npm.cmd --version"]
    };
  }

  return { file: "npm", args: ["--version"] };
}

export function main(options = {}) {
  const platform = options.platform ?? process.platform;
  const execFile = options.execFileSync ?? execFileSync;
  const npmInvocation = resolveNpmInvocation(platform, options);
  const nodeVersion = parseVersion("Node", options.nodeVersion ?? process.version);
  const npmVersion = parseVersion(
    "npm",
    execFile(npmInvocation.file, npmInvocation.args, { encoding: "utf8" })
  );

  assertMinimum("Node", nodeVersion, MINIMUMS.node);
  assertMinimum("npm", npmVersion, MINIMUMS.npm);

  console.log(
    `Trusted publishing runtime OK: Node ${formatVersion(nodeVersion)}, npm ${formatVersion(npmVersion)}.`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
