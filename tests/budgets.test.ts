import { describe, expect, it } from "vitest";
import { evaluateBudgets } from "../src/runner/lighthouse.js";

const budgets = {
  performance: 0.9,
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 200
};

describe("evaluateBudgets", () => {
  it("passes when metrics meet budgets", () => {
    const result = evaluateBudgets(
      {
        performanceScore: 0.92,
        lcpMs: 2100,
        cls: 0.04,
        tbtMs: 150
      },
      budgets
    );

    expect(result).toEqual({
      performance: true,
      lcp: true,
      cls: true,
      tbt: true
    });
  });

  it("fails when a metric exceeds the budget", () => {
    const result = evaluateBudgets(
      {
        performanceScore: 0.84,
        lcpMs: 3100,
        cls: 0.12,
        tbtMs: 240
      },
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
