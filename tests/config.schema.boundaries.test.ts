import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";

function createValidConfig() {
  return {
    timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 1000 },
    playwright: {
      viewport: { width: 1280, height: 720 },
      userAgent: "wqg/0.3.0",
      locale: "en-US",
      colorScheme: "light"
    },
    screenshots: [{ name: "home", path: "/", fullPage: true }],
    lighthouse: {
      budgets: { performance: 0.8, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      formFactor: "desktop"
    },
    visual: { threshold: 0.01 },
    toggles: { a11y: true, perf: true, visual: true }
  };
}

describe("ConfigSchema boundaries", () => {
  it("accepts legacy-compatible config without optional fields", () => {
    const parsed = ConfigSchema.parse(createValidConfig());
    expect(parsed.retries).toBeUndefined();
    expect(parsed.axe).toBeUndefined();
    expect(parsed.visual.pixelmatch).toBeUndefined();
    expect(parsed.visual.ignoreRegions).toBeUndefined();
  });

  it("defaults screenshot fullPage to true when omitted", () => {
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      screenshots: [{ name: "home", path: "/" }]
    });
    expect(parsed.screenshots[0]?.fullPage).toBe(true);
  });

  it("accepts retry boundary values", () => {
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      retries: { count: 5, delayMs: 10000 }
    });
    expect(parsed.retries).toEqual({ count: 5, delayMs: 10000 });
  });

  it("rejects retries.count over maximum", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      retries: { count: 6, delayMs: 100 }
    });
    expect(result.success).toBe(false);
  });

  it("rejects retries.delayMs over maximum", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      retries: { count: 1, delayMs: 10001 }
    });
    expect(result.success).toBe(false);
  });

  it("accepts max axe filter entries", () => {
    const includeRules = Array.from({ length: 50 }, (_, i) => `rule-${i}`);
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      axe: { includeRules }
    });
    expect(parsed.axe?.includeRules).toHaveLength(50);
  });

  it("rejects axe filter list overflow", () => {
    const includeRules = Array.from({ length: 51 }, (_, i) => `rule-${i}`);
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      axe: { includeRules }
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty entries in axe filters", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      axe: { includeTags: [""] }
    });
    expect(result.success).toBe(false);
  });

  it("accepts pixelmatch boundaries", () => {
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      visual: {
        threshold: 1,
        pixelmatch: {
          includeAA: true,
          threshold: 0
        }
      }
    });
    expect(parsed.visual.pixelmatch).toEqual({ includeAA: true, threshold: 0 });
  });

  it("rejects visual threshold below zero", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      visual: { threshold: -0.001 }
    });
    expect(result.success).toBe(false);
  });

  it("rejects visual threshold above one", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      visual: { threshold: 1.001 }
    });
    expect(result.success).toBe(false);
  });

  it("accepts ignoreRegions at max size", () => {
    const ignoreRegions = Array.from({ length: 25 }, (_, i) => ({
      x: i,
      y: i,
      width: 10,
      height: 10
    }));

    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      visual: {
        threshold: 0.01,
        ignoreRegions
      }
    });

    expect(parsed.visual.ignoreRegions).toHaveLength(25);
  });

  it("rejects ignoreRegions overflow", () => {
    const ignoreRegions = Array.from({ length: 26 }, (_, i) => ({
      x: i,
      y: i,
      width: 10,
      height: 10
    }));

    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      visual: {
        threshold: 0.01,
        ignoreRegions
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid ignore region geometry", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      visual: {
        threshold: 0.01,
        ignoreRegions: [{ x: -1, y: 0, width: 10, height: 10 }]
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects screenshot path that is an absolute URL", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      screenshots: [{ name: "home", path: "https://evil.example", fullPage: true }]
    });
    expect(result.success).toBe(false);
  });

  it("strips unknown fields for migration compatibility", () => {
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      futureField: { enabled: true }
    });

    expect(parsed).not.toHaveProperty("futureField");
  });

  it("accepts maximum screenshot count boundary", () => {
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      screenshots: Array.from({ length: 50 }, (_, i) => ({
        name: `shot-${i}`,
        path: `/${i}`,
        fullPage: true
      }))
    });

    expect(parsed.screenshots).toHaveLength(50);
  });

  it("rejects screenshot count overflow", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      screenshots: Array.from({ length: 51 }, (_, i) => ({
        name: `shot-${i}`,
        path: `/${i}`,
        fullPage: true
      }))
    });

    expect(result.success).toBe(false);
  });

  it("accepts max waitForTimeoutMs for screenshot", () => {
    const parsed = ConfigSchema.parse({
      ...createValidConfig(),
      screenshots: [{ name: "home", path: "/", waitForTimeoutMs: 30000 }]
    });

    expect(parsed.screenshots[0]?.waitForTimeoutMs).toBe(30000);
  });

  it("rejects waitForTimeoutMs above maximum", () => {
    const result = ConfigSchema.safeParse({
      ...createValidConfig(),
      screenshots: [{ name: "home", path: "/", waitForTimeoutMs: 30001 }]
    });

    expect(result.success).toBe(false);
  });
});
