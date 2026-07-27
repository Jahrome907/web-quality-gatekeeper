/* global console, process */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, "artifacts", "release");
const VALIDATION_PROFILES = {
  release: ["npm run engines:check", "npm run release:dry-run", "npm pack --ignore-scripts --json"],
  "npm-publish": [
    "node scripts/ci/assert-publish-runtime.mjs",
    "npm run engines:check",
    "npm run validate:full",
    "npm run contracts:check",
    "npm run smoke:pack",
    "npm pack --ignore-scripts --json"
  ]
};

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

function parseArgs() {
  const options = {
    outDir: DEFAULT_OUT_DIR,
    releaseTag: process.env.GITHUB_REF_NAME ? process.env.GITHUB_REF_NAME : null,
    commit: process.env.GITHUB_SHA ? process.env.GITHUB_SHA : null,
    packJson: null,
    validationProfile: "release",
    validationCommands: []
  };

  const args = process.argv;
  for (let index = 2; index !== args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out-dir") {
      index += 1;
      options.outDir = path.resolve(args[index]);
      continue;
    }
    if (arg === "--out") {
      index += 1;
      options.outDir = path.resolve(args[index]);
      continue;
    }
    if (arg === "--release-tag") {
      index += 1;
      options.releaseTag = args[index];
      continue;
    }
    if (arg === "--commit") {
      index += 1;
      options.commit = args[index];
      continue;
    }
    if (arg === "--pack-json") {
      index += 1;
      options.packJson = path.resolve(args[index]);
      continue;
    }
    if (arg === "--validation-profile") {
      index += 1;
      options.validationProfile = args[index];
      continue;
    }
    if (arg === "--validation-command") {
      index += 1;
      options.validationCommands.push(args[index]);
      continue;
    }
    throw new Error("Unknown argument: " + arg);
  }

  return options;
}

function validationCommandsForOptions(options) {
  if (options.validationCommands.length) {
    return options.validationCommands;
  }

  const commands = VALIDATION_PROFILES[options.validationProfile];
  if (!commands) {
    throw new Error(
      "Unknown validation profile " +
        options.validationProfile +
        ". Expected one of: " +
        Object.keys(VALIDATION_PROFILES).join(", ")
    );
  }

  return commands;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function resolvePackArtifact(options) {
  if (!options.packJson) {
    return null;
  }

  const payload = readJsonFile(options.packJson);
  if (!Array.isArray(payload)) {
    return null;
  }
  if (!payload[0]) {
    return null;
  }

  const filename = payload[0].filename ? payload[0].filename : null;
  if (!filename) {
    return null;
  }

  const tarballPath = path.isAbsolute(filename)
    ? filename
    : path.join(path.dirname(options.packJson), filename);
  const size = payload[0].size ? payload[0].size : null;

  return {
    filename: path.basename(tarballPath),
    sha256: sha256File(tarballPath),
    size
  };
}

function toSpdxId(name, version, location) {
  let identity = name;
  if (location) {
    const locationHash = createHash("sha256").update(location).digest("hex").slice(0, 12);
    identity += "-" + version + "-" + locationHash;
  }
  return "SPDXRef-Package-" + identity.replace(/[^A-Za-z0-9.-]+/g, "-");
}

function packageLicense(packageInfo) {
  if (typeof packageInfo.license === "string") {
    return packageInfo.license;
  }
  return "NOASSERTION";
}

function spdxPackage(name, version, packageInfo, location) {
  const license = packageLicense(packageInfo);
  return {
    name,
    SPDXID: toSpdxId(name, version, location),
    versionInfo: version,
    downloadLocation: "NOASSERTION",
    filesAnalyzed: false,
    licenseConcluded: license,
    licenseDeclared: license,
    copyrightText: "NOASSERTION"
  };
}

function resolvePackageLocation(fromLocation, name, lockPackages) {
  let currentLocation = fromLocation;
  while (true) {
    const candidate = currentLocation
      ? currentLocation + "/node_modules/" + name
      : "node_modules/" + name;
    if (lockPackages[candidate]) {
      return candidate;
    }
    if (!currentLocation) {
      return null;
    }

    const parentNodeModules = currentLocation.lastIndexOf("/node_modules/");
    currentLocation = parentNodeModules === -1 ? "" : currentLocation.slice(0, parentNodeModules);
  }
}

function runtimeDependencyLocations(pkg, lock) {
  const lockPackages = lock.packages ? lock.packages : {};
  const rootPackage = lockPackages[""] ? lockPackages[""] : pkg;
  const rootDependencyEdges = Object.assign(
    {},
    rootPackage.dependencies ? rootPackage.dependencies : {},
    rootPackage.optionalDependencies ? rootPackage.optionalDependencies : {}
  );
  const queue = Object.keys(rootDependencyEdges)
    .map(function (name) {
      return { name, location: resolvePackageLocation("", name, lockPackages) };
    })
    .filter(function (entry) {
      return entry.location;
    });
  const seen = new Map();

  while (queue.length) {
    const entry = queue.shift();
    if (!entry) {
      continue;
    }
    const { name, location } = entry;
    if (!location || seen.has(location)) {
      continue;
    }

    const packageInfo = lockPackages[location];
    if (!packageInfo) {
      continue;
    }
    if (packageInfo.dev === true) {
      continue;
    }

    seen.set(location, name);
    const dependencyEdges = Object.assign(
      {},
      packageInfo.dependencies ? packageInfo.dependencies : {},
      packageInfo.optionalDependencies ? packageInfo.optionalDependencies : {}
    );
    for (const dependencyName of Object.keys(dependencyEdges)) {
      const dependencyLocation = resolvePackageLocation(location, dependencyName, lockPackages);
      if (dependencyLocation && !seen.has(dependencyLocation)) {
        queue.push({ name: dependencyName, location: dependencyLocation });
      }
    }
  }

  return seen;
}

function dependencyPackages(pkg, lock) {
  const lockPackages = lock.packages ? lock.packages : {};
  const packages = [spdxPackage(pkg.name, pkg.version, pkg, "")];
  const runtimeLocations = Array.from(runtimeDependencyLocations(pkg, lock)).sort(
    function (left, right) {
      return left[0].localeCompare(right[0]);
    }
  );

  for (const [location, dependencyName] of runtimeLocations) {
    const packageInfo = lockPackages[location];
    if (!packageInfo) {
      continue;
    }
    if (!packageInfo.version) {
      continue;
    }
    const name = packageInfo.name ? packageInfo.name : dependencyName;
    packages.push(spdxPackage(name, packageInfo.version, packageInfo, location));
  }

  packages.sort(function (left, right) {
    const byName = left.name.localeCompare(right.name);
    if (byName) {
      return byName;
    }
    const byVersion = left.versionInfo.localeCompare(right.versionInfo);
    return byVersion ? byVersion : left.SPDXID.localeCompare(right.SPDXID);
  });
  return packages;
}

function buildSbom(pkg, lock, context) {
  const packages = dependencyPackages(pkg, lock);
  const rootId = toSpdxId(pkg.name);
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: pkg.name + "-" + pkg.version,
    documentNamespace:
      context.repository + "/releases/download/" + context.releaseTag + "/sbom.spdx.json",
    creationInfo: {
      created: context.createdAt,
      creators: ["Tool: web-quality-gatekeeper release evidence"]
    },
    packages,
    relationships: [
      {
        spdxElementId: "SPDXRef-DOCUMENT",
        relationshipType: "DESCRIBES",
        relatedSpdxElement: rootId
      }
    ]
  };
}

function buildProvenance(pkg, context, packArtifact) {
  return {
    schemaVersion:
      "https://github.com/Jahrome907/web-quality-gatekeeper/schemas/release-provenance.v1.json",
    generatedAt: context.createdAt,
    repository: context.repository,
    release: {
      tag: context.releaseTag,
      version: pkg.version,
      commit: context.commit
    },
    package: {
      name: pkg.name,
      version: pkg.version,
      node: pkg.engines ? pkg.engines.node : null
    },
    validation: {
      profile: context.validationProfile,
      commands: context.validationCommands
    },
    npm: {
      manualTrustedPublishingWorkflow: ".github/workflows/npm-publish.yml",
      provenanceFlag: "npm publish --provenance"
    },
    tarball: packArtifact,
    artifacts: [
      { name: "release-provenance.json", mediaType: "application/json" },
      { name: "sbom.spdx.json", mediaType: "application/spdx+json" }
    ],
    workflow: {
      name: process.env.GITHUB_WORKFLOW ? process.env.GITHUB_WORKFLOW : null,
      runId: process.env.GITHUB_RUN_ID ? process.env.GITHUB_RUN_ID : null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ? process.env.GITHUB_RUN_ATTEMPT : null
    }
  };
}

function repositoryUrl(pkg) {
  if (pkg.repository) {
    if (typeof pkg.repository === "string") {
      return pkg.repository.replace(/^git\+/, "").replace(/\.git$/, "");
    }
    if (pkg.repository.url) {
      return pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
    }
  }
  return "https://github.com/Jahrome907/web-quality-gatekeeper";
}

function main() {
  const options = parseArgs();
  const pkg = readJsonFile(path.join(ROOT, "package.json"));
  const lock = readJsonFile(path.join(ROOT, "package-lock.json"));
  const releaseTag = options.releaseTag ? options.releaseTag : "v" + pkg.version;
  const createdAt = process.env.WQG_RELEASE_EVIDENCE_NOW
    ? process.env.WQG_RELEASE_EVIDENCE_NOW
    : new Date().toISOString();
  const validationCommands = validationCommandsForOptions(options);
  const context = {
    createdAt,
    releaseTag,
    commit: options.commit ? options.commit : "unknown",
    repository: repositoryUrl(pkg),
    validationProfile: options.validationProfile,
    validationCommands
  };
  const packArtifact = resolvePackArtifact(options);

  mkdirSync(options.outDir, { recursive: true });
  writeJsonFile(
    path.join(options.outDir, "release-provenance.json"),
    buildProvenance(pkg, context, packArtifact)
  );
  writeJsonFile(path.join(options.outDir, "sbom.spdx.json"), buildSbom(pkg, lock, context));

  console.log("Wrote release evidence artifacts:");
  console.log("- release-provenance.json");
  console.log("- sbom.spdx.json");
}

main();
