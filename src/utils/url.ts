import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class UsageError extends Error {
  exitCode = 2;
}

const LOCAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^localhost\.localdomain$/i
];

const INTERNAL_HOST_PATTERNS = [
  /^127\.\d+\.\d+\.\d+$/,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/
];

const INTERNAL_IP_BLOCK_LIST = new BlockList();
INTERNAL_IP_BLOCK_LIST.addAddress("0.0.0.0", "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("10.0.0.0", 8, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("127.0.0.0", 8, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("169.254.0.0", 16, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("172.16.0.0", 12, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("192.168.0.0", 16, "ipv4");
INTERNAL_IP_BLOCK_LIST.addAddress("::", "ipv6");
INTERNAL_IP_BLOCK_LIST.addAddress("::1", "ipv6");
INTERNAL_IP_BLOCK_LIST.addSubnet("fc00::", 7, "ipv6");
INTERNAL_IP_BLOCK_LIST.addSubnet("fe80::", 10, "ipv6");

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function isInternalIpAddress(address: string): boolean {
  const ipVersion = isIP(address);
  if (ipVersion === 0) {
    return false;
  }
  const type = ipVersion === 6 ? "ipv6" : "ipv4";
  return INTERNAL_IP_BLOCK_LIST.check(address, type);
}

export function isInternalHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (isLocalHostname(normalized)) {
    return true;
  }

  if (INTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  return isInternalIpAddress(normalized);
}

export interface TargetClassification {
  url: string;
  hostname: string;
  isInternal: boolean;
  resolutionFailed: boolean;
  reason: "literal" | "dns" | "none";
  resolvedAddresses: string[];
}

async function resolveHostAddresses(
  hostname: string
): Promise<{ addresses: string[]; resolutionFailed: boolean }> {
  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    const unique = new Set<string>();
    for (const result of results) {
      if (result?.address) {
        unique.add(result.address);
      }
    }
    return {
      addresses: Array.from(unique),
      resolutionFailed: false
    };
  } catch {
    return {
      addresses: [],
      resolutionFailed: true
    };
  }
}

export function validateUrl(raw: string): { url: string; isInternal: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError(`Invalid URL: ${raw}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UsageError(`Invalid URL: ${raw}`);
  }

  const internal = isInternalHost(parsed.hostname);
  return { url: parsed.toString(), isInternal: internal };
}

export async function classifyTargetUrl(raw: string): Promise<TargetClassification> {
  const validated = validateUrl(raw);
  const hostname = normalizeHostname(new URL(validated.url).hostname);
  if (validated.isInternal) {
    return {
      url: validated.url,
      hostname,
      isInternal: true,
      resolutionFailed: false,
      reason: "literal",
      resolvedAddresses: []
    };
  }

  const { addresses: resolvedAddresses, resolutionFailed } = await resolveHostAddresses(hostname);
  const hasInternalResolvedAddress = resolvedAddresses.some((address) => isInternalIpAddress(address));

  return {
    url: validated.url,
    hostname,
    isInternal: hasInternalResolvedAddress,
    resolutionFailed,
    reason: hasInternalResolvedAddress ? "dns" : "none",
    resolvedAddresses
  };
}
