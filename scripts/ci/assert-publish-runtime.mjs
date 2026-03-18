/* global console, process */
import { execFileSync } from "node:child_process";

const MINIMUMS = {
  node: [22, 14, 0],
  npm: [11, 5, 1]
};

function parseVersion(label, rawValue) {
  const match = rawValue.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    throw new Error(`${label} version '${rawValue.trim()}' is not a supported semver string.`);
  }

  return match.slice(1).map((value) => Number.parseInt(value, 10));
}

function isBelowMinimum(actual, minimum) {
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

function formatVersion(version) {
  return version.join(".");
}

function assertMinimum(label, actual, minimum) {
  if (isBelowMinimum(actual, minimum)) {
    throw new Error(
      `Trusted publishing requires ${label} ${formatVersion(minimum)} or later (found ${formatVersion(actual)}).`
    );
  }
}

function main() {
  const nodeVersion = parseVersion("Node", process.version);
  const npmVersion = parseVersion(
    "npm",
    execFileSync("npm", ["--version"], { encoding: "utf8" })
  );

  assertMinimum("Node", nodeVersion, MINIMUMS.node);
  assertMinimum("npm", npmVersion, MINIMUMS.npm);

  console.log(`Trusted publishing runtime OK: Node ${formatVersion(nodeVersion)}, npm ${formatVersion(npmVersion)}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
