import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const POLICY_DIR = path.resolve(THIS_DIR, "../../configs/policies");

const BUILTIN_POLICIES = ["marketing", "docs", "ecommerce", "saas"] as const;

export type BuiltinPolicyName = (typeof BUILTIN_POLICIES)[number];

export function listBuiltinPolicies(): BuiltinPolicyName[] {
  return [...BUILTIN_POLICIES];
}

export function resolvePolicyReference(reference: string, cwd: string): string {
  const trimmed = reference.trim();
  if (trimmed.length === 0) {
    throw new Error(
      'Policy reference must not be empty. Use a built-in policy like "docs" or a JSON file path such as ./configs/policies/custom.json.'
    );
  }

  const byPrefix = trimmed.startsWith("policy:") ? trimmed.slice("policy:".length) : trimmed;
  if ((BUILTIN_POLICIES as readonly string[]).includes(byPrefix)) {
    return path.join(POLICY_DIR, `${byPrefix}.json`);
  }

  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  return path.resolve(cwd, trimmed);
}
