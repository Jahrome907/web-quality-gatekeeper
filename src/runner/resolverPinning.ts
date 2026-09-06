import { UsageError } from "../utils/url.js";

const HOST_RESOLVER_RULES_PREFIX = "--host-resolver-rules=";

// One initial launch plus six retries allows ordinary redirect/CDN discovery
// without letting an audited page consume an entire CI job by forcing relaunches.
export const MAX_RESOLVER_PINNING_RELAUNCHES = 6;
export const MAX_RESOLVER_PINNING_HOSTS = 24;
export const MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES = 4 * 1024;

export class ResolverPinningBudgetError extends UsageError {}

interface ResolverHostVerification {
  hostResolverRules: string | null;
}

export function coordinateResolverHostVerification<T extends ResolverHostVerification | null>(
  hosts: Map<string, string | null>,
  pendingVerifications: Map<string, Promise<T>>,
  hostname: string,
  runnerName: string,
  verify: () => Promise<T>
): Promise<T> {
  if (hosts.has(hostname)) {
    return verify();
  }

  const pendingVerification = pendingVerifications.get(hostname);
  if (pendingVerification) {
    return pendingVerification;
  }

  const nextHostCount = hosts.size + pendingVerifications.size + 1;
  if (nextHostCount > MAX_RESOLVER_PINNING_HOSTS) {
    throw new ResolverPinningBudgetError(
      `${runnerName} resolver pinning hostname budget exceeded while adding ${hostname}: ` +
        `${nextHostCount} hosts exceeds the ${MAX_RESOLVER_PINNING_HOSTS}-host limit. ` +
        "Reduce the number of cross-host redirects or subresources."
    );
  }

  const verification = Promise.resolve()
    .then(verify)
    .then((verifiedTarget) => {
      addVerifiedResolverHost(
        hosts,
        hostname,
        verifiedTarget?.hostResolverRules ?? null,
        runnerName
      );
      return verifiedTarget;
    });
  const coordinatedVerification = verification.then(
    (verifiedTarget) => {
      if (pendingVerifications.get(hostname) === coordinatedVerification) {
        pendingVerifications.delete(hostname);
      }
      return verifiedTarget;
    },
    (error: unknown) => {
      if (pendingVerifications.get(hostname) === coordinatedVerification) {
        pendingVerifications.delete(hostname);
      }
      throw error;
    }
  );
  pendingVerifications.set(hostname, coordinatedVerification);
  return coordinatedVerification;
}

export function combineHostResolverRules(hosts: Map<string, string | null>): string | null {
  const rules = Array.from(
    new Set(Array.from(hosts.values()).filter((rule): rule is string => !!rule))
  );
  return rules.length > 0 ? rules.join(", ") : null;
}

export function createResolverLaunchSnapshot(
  hosts: ReadonlyMap<string, string | null>,
  fallbackRules: string | null = null
): { pinnedHosts: Map<string, string | null>; hostResolverRules: string | null } {
  const pinnedHosts = new Map(hosts);
  return {
    pinnedHosts,
    hostResolverRules: combineHostResolverRules(pinnedHosts) ?? fallbackRules
  };
}

export function buildHostResolverRuleArgument(
  rules: string | null,
  runnerName: string,
  hostname: string
): string | null {
  if (!rules) {
    return null;
  }

  const argument = `${HOST_RESOLVER_RULES_PREFIX}${rules}`;
  const argumentBytes = Buffer.byteLength(argument, "utf8");
  if (argumentBytes > MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES) {
    throw new ResolverPinningBudgetError(
      `${runnerName} resolver pinning argument budget exceeded while adding ${hostname}: ` +
        `${argumentBytes} bytes exceeds the ${MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES}-byte limit. ` +
        "Reduce the number of cross-host redirects or subresources."
    );
  }

  return argument;
}

export function addVerifiedResolverHost(
  hosts: Map<string, string | null>,
  hostname: string,
  rule: string | null,
  runnerName: string
): void {
  if (hosts.has(hostname)) {
    return;
  }

  const nextHostCount = hosts.size + 1;
  if (nextHostCount > MAX_RESOLVER_PINNING_HOSTS) {
    throw new ResolverPinningBudgetError(
      `${runnerName} resolver pinning hostname budget exceeded while adding ${hostname}: ` +
        `${nextHostCount} hosts exceeds the ${MAX_RESOLVER_PINNING_HOSTS}-host limit. ` +
        "Reduce the number of cross-host redirects or subresources."
    );
  }

  const nextHosts = new Map(hosts);
  nextHosts.set(hostname, rule);
  buildHostResolverRuleArgument(combineHostResolverRules(nextHosts), runnerName, hostname);
  hosts.set(hostname, rule);
}

export function assertResolverRelaunchAvailable(
  runnerName: string,
  relaunchCount: number,
  hostname: string
): void {
  if (relaunchCount < MAX_RESOLVER_PINNING_RELAUNCHES) {
    return;
  }

  throw new ResolverPinningBudgetError(
    `${runnerName} resolver pinning relaunch budget exceeded while adding ${hostname}: ` +
      `${relaunchCount + 1} launches reached the ${MAX_RESOLVER_PINNING_RELAUNCHES + 1}-launch limit. ` +
      "Reduce the number of cross-host redirects or subresources."
  );
}
