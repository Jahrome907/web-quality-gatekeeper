import { UsageError } from "../utils/url.js";

const HOST_RESOLVER_RULES_PREFIX = "--host-resolver-rules=";

// One initial launch plus six retries allows ordinary redirect/CDN discovery
// without letting an audited page consume an entire CI job by forcing relaunches.
export const MAX_RESOLVER_PINNING_RELAUNCHES = 6;
export const MAX_RESOLVER_PINNING_HOSTS = 24;
export const MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES = 4 * 1024;

export class ResolverPinningBudgetError extends UsageError {}

export type ResolverHostReservation = "known" | "pending" | "reserved";

export function reserveResolverHost(
  hosts: ReadonlyMap<string, string | null>,
  pendingHosts: Set<string>,
  hostname: string,
  runnerName: string
): ResolverHostReservation {
  if (hosts.has(hostname)) {
    return "known";
  }
  if (pendingHosts.has(hostname)) {
    return "pending";
  }

  const nextHostCount = hosts.size + pendingHosts.size + 1;
  if (nextHostCount > MAX_RESOLVER_PINNING_HOSTS) {
    throw new ResolverPinningBudgetError(
      `${runnerName} resolver pinning hostname budget exceeded while adding ${hostname}: ` +
        `${nextHostCount} hosts exceeds the ${MAX_RESOLVER_PINNING_HOSTS}-host limit. ` +
        "Reduce the number of cross-host redirects or subresources."
    );
  }

  pendingHosts.add(hostname);
  return "reserved";
}

export function combineHostResolverRules(hosts: Map<string, string | null>): string | null {
  const rules = Array.from(
    new Set(Array.from(hosts.values()).filter((rule): rule is string => !!rule))
  );
  return rules.length > 0 ? rules.join(", ") : null;
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
