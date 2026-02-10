import { afterEach, describe, expect, it, vi } from "vitest";
import { durationMs, nowIso, Timer } from "../src/utils/timing.js";

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

describe("Timer class", () => {
  it("tracks elapsed time with sub-ms precision", async () => {
    const timer = Timer.start("test-timer");
    await new Promise((resolve) => setTimeout(resolve, 15));
    const result = timer.finish();

    expect(result.label).toBe("test-timer");
    expect(result.totalMs).toBeGreaterThan(0);
    expect(result.checkpoints).toEqual([]);
  });

  it("records named checkpoints in order", async () => {
    const timer = Timer.start("multi-step");
    await new Promise((resolve) => setTimeout(resolve, 5));
    timer.checkpoint("step-a");
    await new Promise((resolve) => setTimeout(resolve, 5));
    timer.checkpoint("step-b");
    const result = timer.finish();

    expect(result.checkpoints).toHaveLength(2);
    expect(result.checkpoints[0]!.name).toBe("step-a");
    expect(result.checkpoints[1]!.name).toBe("step-b");
    expect(result.checkpoints[0]!.elapsedMs).toBeLessThan(result.checkpoints[1]!.elapsedMs);
    expect(result.checkpoints[1]!.elapsedMs).toBeLessThanOrEqual(result.totalMs);
  });

  it("throws on double finish", () => {
    const timer = Timer.start("once");
    timer.finish();
    expect(() => timer.finish()).toThrow('Timer "once" is already finished');
  });

  it("throws on checkpoint after finish", () => {
    const timer = Timer.start("sealed");
    timer.finish();
    expect(() => timer.checkpoint("late")).toThrow('Timer "sealed" is already finished');
  });

  it("reports current elapsed without finishing", async () => {
    const timer = Timer.start("peek");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const snap = timer.elapsed();
    expect(snap).toBeGreaterThan(0);
    // Timer can still finish
    const result = timer.finish();
    expect(result.totalMs).toBeGreaterThanOrEqual(snap);
  });

  it("supports chained checkpoints via fluent API", () => {
    const timer = Timer.start("chain");
    const returned = timer.checkpoint("a").checkpoint("b");
    expect(returned).toBe(timer);
    const result = timer.finish();
    expect(result.checkpoints).toHaveLength(2);
  });
});
