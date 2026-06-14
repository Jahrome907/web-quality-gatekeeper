/* global console, process */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

function parseVersion(version) {
  const match = String(version)
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3], 10)
  ];
}

function minimumFromRange(range) {
  const match = String(range).match(/>=\s*(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2], 10),
    Number.parseInt(match[3] ?? "0", 10)
  ];
}

export function satisfiesMinimumNode(version, range) {
  const current = parseVersion(version);
  const minimum = minimumFromRange(range);
  if (!current || !minimum) {
    return false;
  }

  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) {
      return true;
    }
    if (current[index] < minimum[index]) {
      return false;
    }
  }
  return true;
}

export function assertNodeEngine(version = process.versions.node, range = pkg.engines?.node) {
  if (!range) {
    return {
      ok: true,
      message: `Node.js ${version} accepted because package.json does not declare engines.node.`
    };
  }

  if (satisfiesMinimumNode(version, range)) {
    return {
      ok: true,
      message: `Node.js ${version} satisfies ${range}.`
    };
  }

  return {
    ok: false,
    message: `Node.js ${version} does not satisfy package engines.node ${range}. Use Node.js ${range.replace(/^>=\s*/, "")} or later before running release validation.`
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = assertNodeEngine();
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}
