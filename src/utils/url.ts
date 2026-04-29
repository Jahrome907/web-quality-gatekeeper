import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class UsageError extends Error {
  exitCode = 2;
}

function invalidUrlMessage(raw: string): string {
  return `Invalid URL: ${raw}. Expected an absolute http:// or https:// URL, for example https://example.com/.`;
}

function unsupportedProtocolMessage(raw: string): string {
  return `Invalid URL: ${raw}. Use http:// or https:// URLs only.`;
}

function credentialsNotAllowedMessage(raw: string): string {
  return `Invalid URL: ${raw}. Username/password in URLs are not allowed. Use --header/--cookie inputs instead.`;
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
INTERNAL_IP_BLOCK_LIST.addSubnet("100.64.0.0", 10, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("127.0.0.0", 8, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("169.254.0.0", 16, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("172.16.0.0", 12, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("192.168.0.0", 16, "ipv4");
INTERNAL_IP_BLOCK_LIST.addSubnet("198.18.0.0", 15, "ipv4");
INTERNAL_IP_BLOCK_LIST.addAddress("::", "ipv6");
INTERNAL_IP_BLOCK_LIST.addAddress("::1", "ipv6");
INTERNAL_IP_BLOCK_LIST.addSubnet("fc00::", 7, "ipv6");
INTERNAL_IP_BLOCK_LIST.addSubnet("fe80::", 10, "ipv6");

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

export function normalizeUrlHostname(raw: string): string {
  return normalizeHostname(new URL(validateUrl(raw).url).hostname);
}

export function isAuditableHttpUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
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
  pinnedAddress: string | null;
}

export interface TargetResolutionPolicy {
  allowInternalTargets: boolean;
  blockInternalTargets: boolean;
}

export interface WarningLogger {
  warn: (message: string) => void;
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
    throw new UsageError(invalidUrlMessage(raw));
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UsageError(unsupportedProtocolMessage(raw));
  }

  if (parsed.username || parsed.password) {
    throw new UsageError(credentialsNotAllowedMessage(raw));
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
      resolvedAddresses: [],
      pinnedAddress: null
    };
  }

  const { addresses: resolvedAddresses, resolutionFailed } = await resolveHostAddresses(hostname);
  const hasInternalResolvedAddress = resolvedAddresses.some((address) => isInternalIpAddress(address));
  const pinnedAddress =
    resolutionFailed || hasInternalResolvedAddress || isInternalHost(hostname)
      ? null
      : resolvedAddresses.find((address) => isIP(address) === 4) ?? resolvedAddresses[0] ?? null;

  return {
    url: validated.url,
    hostname,
    isInternal: hasInternalResolvedAddress,
    resolutionFailed,
    reason: hasInternalResolvedAddress ? "dns" : "none",
    resolvedAddresses,
    pinnedAddress
  };
}

export function buildHostResolverRules(hostname: string, pinnedAddress: string | null): string | null {
  if (!pinnedAddress || isIP(hostname) !== 0) {
    return null;
  }

  return `MAP ${normalizeHostname(hostname)} ${pinnedAddress}`;
}

function formatResolvedSuffix(classification: TargetClassification): string {
  return classification.reason === "dns" && classification.resolvedAddresses.length > 0
    ? ` (resolved: ${classification.resolvedAddresses.join(", ")})`
    : "";
}

export async function resolveAuditedTarget(
  raw: string,
  logger: WarningLogger,
  policy: TargetResolutionPolicy,
  options: { context?: string } = {}
): Promise<{
  url: string;
  hostResolverRules: string | null;
  classification: TargetClassification;
}> {
  const classification = await classifyTargetUrl(raw);
  const context = options.context ?? "target";
  const resolvedSuffix = formatResolvedSuffix(classification);

  if (!policy.allowInternalTargets && policy.blockInternalTargets && classification.isInternal) {
    throw new UsageError(
      `Blocked internal ${context}: ${classification.hostname}${resolvedSuffix}. ` +
        "Set --allow-internal-targets or WQG_ALLOW_INTERNAL_TARGETS=true to override."
    );
  }

  if (!policy.allowInternalTargets && policy.blockInternalTargets && classification.resolutionFailed) {
    throw new UsageError(
      `Blocked unresolved ${context} in sensitive mode: ${classification.hostname}. ` +
        "DNS resolution failed during SSRF safety checks. " +
        "Set --allow-internal-targets or WQG_ALLOW_INTERNAL_TARGETS=true to override."
    );
  }

  if (classification.resolutionFailed) {
    logger.warn(
      `Could not resolve ${classification.hostname} during SSRF safety checks for the ${context}. ` +
        "Proceeding because this run is not in sensitive mode."
    );
  }

  if (classification.isInternal) {
    logger.warn(
      `Auditing internal network ${context} (${classification.hostname}${resolvedSuffix}). ` +
        "Ensure this is intentional. See SECURITY.md for SSRF guidance."
    );
  }

  return {
    url: classification.url,
    hostResolverRules: buildHostResolverRules(classification.hostname, classification.pinnedAddress),
    classification
  };
}

export interface VerifiedAuditTarget {
  url: string;
  hostResolverRules: string | null;
}

export interface NavigationTargetVerifierOptions {
  initialTrustedHosts?: Iterable<[string, string | null]>;
  trustResolvedHosts?: boolean;
}

export class NavigationTargetVerifier {
  private readonly verifiedTargets = new Map<string, VerifiedAuditTarget>();
  private readonly trustedHostResolverRules = new Map<string, string | null>();
  private readonly trustResolvedHosts: boolean;

  constructor(
    private readonly logger: WarningLogger,
    private readonly policy: TargetResolutionPolicy | null | undefined,
    options: NavigationTargetVerifierOptions = {}
  ) {
    this.trustResolvedHosts = options.trustResolvedHosts ?? true;
    for (const [hostname, hostResolverRules] of options.initialTrustedHosts ?? []) {
      this.trustedHostResolverRules.set(normalizeHostname(hostname), hostResolverRules);
    }
  }

  async verify(targetUrl: string, context: string): Promise<VerifiedAuditTarget | null> {
    if (!this.policy) {
      return null;
    }

    const existing = this.verifiedTargets.get(targetUrl);
    if (existing) {
      return existing;
    }

    const targetHostname = normalizeUrlHostname(targetUrl);
    if (this.trustedHostResolverRules.has(targetHostname)) {
      const trustedTarget = {
        url: new URL(targetUrl).toString(),
        hostResolverRules: this.trustedHostResolverRules.get(targetHostname) ?? null
      };
      this.cacheVerifiedTarget(targetUrl, trustedTarget);
      return trustedTarget;
    }

    const resolvedTarget = await resolveAuditedTarget(targetUrl, this.logger, this.policy, {
      context
    });
    const verifiedTarget = {
      url: resolvedTarget.url,
      hostResolverRules: resolvedTarget.hostResolverRules
    };

    if (this.trustResolvedHosts) {
      this.trustedHostResolverRules.set(
        resolvedTarget.classification.hostname,
        resolvedTarget.hostResolverRules
      );
      this.cacheVerifiedTarget(targetUrl, verifiedTarget);
    }

    return verifiedTarget;
  }

  private cacheVerifiedTarget(targetUrl: string, verifiedTarget: VerifiedAuditTarget): void {
    this.verifiedTargets.set(targetUrl, verifiedTarget);
    this.verifiedTargets.set(verifiedTarget.url, verifiedTarget);
  }
}
