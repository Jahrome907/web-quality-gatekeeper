/* global console, process */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const GHSA_ID_PATTERN = /GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}/i;

function parseArgs(argv) {
  const args = { exceptionsPath: "configs/security/audit-exceptions.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--exceptions") {
      args.exceptionsPath = argv[i + 1] ?? args.exceptionsPath;
      i += 1;
    }
  }
  return args;
}

function readExceptions(filePath) {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("exceptions file must be an array");
    }

    return parsed.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`exceptions[${index}] must be an object`);
      }

      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const pkg = typeof entry.package === "string" ? entry.package.trim() : "";
      const owner = typeof entry.owner === "string" ? entry.owner.trim() : "";
      const reason = typeof entry.reason === "string" ? entry.reason.trim() : "";
      const expiresOn = typeof entry.expiresOn === "string" ? entry.expiresOn.trim() : "";

      if (!id || !pkg || !owner || !reason || !expiresOn) {
        throw new Error(
          `exceptions[${index}] requires non-empty id, package, owner, reason, expiresOn`
        );
      }

      const expiresAt = new Date(`${expiresOn}T23:59:59.999Z`);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new Error(`exceptions[${index}] has invalid expiresOn date: ${expiresOn}`);
      }

      return {
        id,
        package: pkg,
        owner,
        reason,
        expiresOn,
        expiresAt
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read audit exceptions from ${filePath}: ${message}`, { cause: error });
  }
}

function severityRank(severity) {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "moderate") return 2;
  if (severity === "low") return 1;
  return 0;
}

function extractAdvisoryRecords(vulnName, vulnerability) {
  const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
  const records = [];

  for (const item of via) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const severity = typeof item.severity === "string" ? item.severity : vulnerability?.severity;
    if (severityRank(severity) < severityRank("high")) {
      continue;
    }

    const advisoryIdMatch =
      typeof item.url === "string" ? item.url.match(GHSA_ID_PATTERN) : null;
    const advisoryId =
      advisoryIdMatch?.[0]?.toUpperCase() ??
      (typeof item.source === "number"
        ? `npm-${item.source}`
        : typeof item.name === "string"
          ? item.name
          : vulnName);

    records.push({
      package: vulnName,
      severity,
      id: advisoryId,
      title: typeof item.title === "string" ? item.title : "",
      url: typeof item.url === "string" ? item.url : ""
    });
  }

  if (records.length === 0 && severityRank(vulnerability?.severity) >= severityRank("high")) {
    records.push({
      package: vulnName,
      severity: vulnerability.severity,
      id: vulnName,
      title: "",
      url: ""
    });
  }

  return records;
}

function findMatchingException(record, exceptions, now) {
  return exceptions.find((entry) => {
    if (entry.package !== record.package) {
      return false;
    }
    if (entry.id !== record.id) {
      return false;
    }
    return entry.expiresAt.getTime() >= now.getTime();
  });
}

function assertNoExpiredExceptions(exceptions, now) {
  const expired = exceptions.filter((entry) => entry.expiresAt.getTime() < now.getTime());
  if (expired.length === 0) {
    return;
  }

  console.error("Expired audit exceptions detected:");
  for (const entry of expired) {
    console.error(
      `- ${entry.package} / ${entry.id} expired on ${entry.expiresOn} (owner: ${entry.owner})`
    );
  }
  process.exit(1);
}

function main() {
  const { exceptionsPath } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const exceptions = readExceptions(exceptionsPath);
  assertNoExpiredExceptions(exceptions, now);

  const npmExecPath = process.env.npm_execpath;
  const auditCommand = npmExecPath
    ? {
        file: process.execPath,
        args: [npmExecPath, "audit", "--omit=dev", "--json"]
      }
    : {
        file: process.platform === "win32" ? "npm.cmd" : "npm",
        args: ["audit", "--omit=dev", "--json"]
      };

  const run = spawnSync(auditCommand.file, auditCommand.args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (run.error) {
    console.error("Unable to execute npm audit.");
    console.error(run.error.message);
    process.exit(1);
  }

  const output = [run.stdout, run.stderr].filter(Boolean).join("\n");
  let parsed;
  try {
    parsed = JSON.parse(output || "{}");
  } catch {
    console.error("Unable to parse npm audit JSON output.");
    console.error(output);
    process.exit(run.status ?? 1);
  }

  const hasVulnerabilityMap =
    parsed &&
    typeof parsed === "object" &&
    parsed.vulnerabilities &&
    typeof parsed.vulnerabilities === "object";

  if (!hasVulnerabilityMap || parsed.error) {
    console.error("npm audit did not return usable vulnerability data.");
    console.error(output);
    process.exit(1);
  }

  const vulnerabilities = parsed.vulnerabilities;

  const rawFindings = Object.entries(vulnerabilities)
    .flatMap(([name, details]) => extractAdvisoryRecords(name, details));

  const deduped = new Map();
  for (const finding of rawFindings) {
    deduped.set(`${finding.package}::${finding.id}`, finding);
  }

  const findings = Array.from(deduped.values());
  const unresolved = [];
  const accepted = [];

  for (const finding of findings) {
    const exception = findMatchingException(finding, exceptions, now);
    if (exception) {
      accepted.push({ finding, exception });
    } else {
      unresolved.push(finding);
    }
  }

  if (accepted.length > 0) {
    console.log("Accepted runtime audit findings (temporary exceptions):");
    for (const item of accepted) {
      console.log(
        `- ${item.finding.severity.toUpperCase()} ${item.finding.package} / ${item.finding.id}` +
          ` (expires ${item.exception.expiresOn}, owner ${item.exception.owner})`
      );
    }
  }

  if (unresolved.length > 0) {
    console.error("Unresolved runtime vulnerabilities (high/critical):");
    for (const finding of unresolved) {
      const suffix = finding.url ? ` (${finding.url})` : "";
      console.error(`- ${finding.severity.toUpperCase()} ${finding.package} / ${finding.id}${suffix}`);
    }
    process.exit(1);
  }

  console.log("Runtime audit gate passed (no unexcepted high/critical vulnerabilities).");
}

main();
