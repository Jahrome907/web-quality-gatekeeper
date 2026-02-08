import { afterEach, describe, expect, it, vi } from "vitest";
import { durationMs, nowIso } from "../src/utils/timing.js";

describe("timing utilities", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ISO timestamp from nowIso", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T12:34:56.789Z"));

    expect(nowIso()).toBe("2026-02-08T12:34:56.789Z");
  });

  it("computes positive duration delta", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T00:00:00.000Z"));

    const start = Date.now();
    vi.setSystemTime(new Date("2026-02-08T00:00:00.250Z"));

    expect(durationMs(start)).toBe(250);
  });

  it("returns zero duration when now equals start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T00:00:00.000Z"));

    const start = Date.now();
    expect(durationMs(start)).toBe(0);
  });

  it("returns negative duration when start is in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T00:00:00.000Z"));

    const futureStart = Date.now() + 10;
    expect(durationMs(futureStart)).toBe(-10);
  });

  it("tracks duration across multiple clock jumps", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T00:00:00.000Z"));

    const start = Date.now();
    vi.setSystemTime(new Date("2026-02-08T00:00:01.250Z"));
    vi.setSystemTime(new Date("2026-02-08T00:00:03.000Z"));

    expect(durationMs(start)).toBe(3000);
  });

  it("returns deterministic ISO format with milliseconds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T04:05:06.007Z"));

    expect(nowIso()).toMatch(/^2026-02-08T04:05:06\.007Z$/);
  });
});
