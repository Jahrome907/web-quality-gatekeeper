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

  const hasPolicyPrefix = trimmed.startsWith("policy:");
  const byPrefix = hasPolicyPrefix ? trimmed.slice("policy:".length).trim() : trimmed;
  if (byPrefix.length === 0) {
    throw new Error(
      'Policy reference must not be empty. Use a built-in policy like "docs" or a JSON file path such as ./configs/policies/custom.json.'
    );
  }

  if ((BUILTIN_POLICIES as readonly string[]).includes(byPrefix)) {
    return path.join(POLICY_DIR, `${byPrefix}.json`);
  }

  const pathReference = hasPolicyPrefix ? byPrefix : trimmed;
  if (path.isAbsolute(pathReference)) {
    return pathReference;
  }

  return path.resolve(cwd, pathReference);
}
