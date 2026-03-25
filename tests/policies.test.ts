import { describe, expect, it } from "vitest";
import { resolvePolicyReference } from "../src/config/policies.js";

describe("resolvePolicyReference", () => {
  it("rejects empty policy references with actionable guidance", () => {
    expect(() => resolvePolicyReference("   ", process.cwd())).toThrow(
      'Policy reference must not be empty. Use a built-in policy like "docs" or a JSON file path such as ./configs/policies/custom.json.'
    );
  });
});
