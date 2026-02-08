import { describe, expect, it } from "vitest";
import { evaluateBudgets, toFixedScore } from "../src/runner/lighthouse.js";
import { calculateMismatchRatio } from "../src/runner/visualDiff.js";

describe("toFixedScore", () => {
  it("rounds number to 2 decimal places", () => {
    expect(toFixedScore(0.9234)).toBe(0.92);
  });

  it("returns 0 for null", () => {
    expect(toFixedScore(null)).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(toFixedScore(undefined)).toBe(0);
  });

  it("handles exact values", () => {
    expect(toFixedScore(1.0)).toBe(1);
  });

  it("handles zero", () => {
    expect(toFixedScore(0)).toBe(0);
  });
});

describe("evaluateBudgets — boundary cases", () => {
  const budgets = {
    performance: 0.9,
    lcpMs: 2500,
    cls: 0.1,
    tbtMs: 200
  };

  it("passes at exact threshold", () => {
    const result = evaluateBudgets(
      { performanceScore: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      budgets
    );
    expect(result).toEqual({
      performance: true,
      lcp: true,
      cls: true,
      tbt: true
    });
  });

  it("fails just below threshold", () => {
    const result = evaluateBudgets(
      { performanceScore: 0.89, lcpMs: 2501, cls: 0.11, tbtMs: 201 },
      budgets
    );
    expect(result).toEqual({
      performance: false,
      lcp: false,
      cls: false,
      tbt: false
    });
  });
});

describe("calculateMismatchRatio", () => {
  it("calculates ratio for normal case", () => {
    expect(calculateMismatchRatio(100, 100, 100)).toBe(0.01);
  });

  it("returns 0 for zero width", () => {
    expect(calculateMismatchRatio(50, 0, 100)).toBe(0);
  });

  it("returns 0 for zero height", () => {
    expect(calculateMismatchRatio(50, 100, 0)).toBe(0);
  });

  it("returns 0 for zero diff pixels", () => {
    expect(calculateMismatchRatio(0, 100, 100)).toBe(0);
  });

  it("returns 1 for full mismatch", () => {
    expect(calculateMismatchRatio(10000, 100, 100)).toBe(1);
  });
});
