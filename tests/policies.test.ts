import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolvePolicyReference } from "../src/config/policies.js";

describe("resolvePolicyReference", () => {
  it("rejects empty policy references with actionable guidance", () => {
    expect(() => resolvePolicyReference("   ", process.cwd())).toThrow(
      'Policy reference must not be empty. Use a built-in policy like "docs" or a JSON file path such as ./configs/policies/custom.json.'
    );
    expect(() => resolvePolicyReference("policy:", process.cwd())).toThrow(
      'Policy reference must not be empty. Use a built-in policy like "docs" or a JSON file path such as ./configs/policies/custom.json.'
    );
  });

  it("resolves policy-prefixed custom paths relative to the provided workspace", () => {
    const cwd = path.join(process.cwd(), "consumer");

    expect(resolvePolicyReference("policy:configs/policies/custom.json", cwd)).toBe(
      path.resolve(cwd, "configs/policies/custom.json")
    );
  });
});
