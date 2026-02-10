import { describe, expect, it, vi } from "vitest";
import { retry, computeDelay } from "../src/utils/retry.js";

describe("retry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retry(fn, { maxRetries: 2, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");
    const result = await retry(fn, { maxRetries: 1, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent"));
    await expect(retry(fn, { maxRetries: 1, baseDelayMs: 0 })).rejects.toThrow("persistent");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("logs warning on retry when logger provided", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");
    await retry(fn, { maxRetries: 1, baseDelayMs: 0, logger });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Attempt 1/1 failed")
    );
  });

  it("skips retry when isRetryable returns false", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fatal"));
    await expect(
      retry(fn, {
        maxRetries: 3,
        baseDelayMs: 0,
        isRetryable: () => false
      })
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("computeDelay", () => {
  it("returns constant delay for fixed strategy", () => {
    expect(computeDelay("fixed", 100, 30_000, 0, 100)).toBe(100);
    expect(computeDelay("fixed", 100, 30_000, 5, 100)).toBe(100);
  });

  it("doubles delay for exponential strategy", () => {
    expect(computeDelay("exponential", 100, 30_000, 0, 100)).toBe(100);
    expect(computeDelay("exponential", 100, 30_000, 1, 100)).toBe(200);
    expect(computeDelay("exponential", 100, 30_000, 2, 100)).toBe(400);
    expect(computeDelay("exponential", 100, 30_000, 3, 100)).toBe(800);
  });

  it("caps exponential delay at maxDelayMs", () => {
    expect(computeDelay("exponential", 100, 500, 10, 100)).toBe(500);
  });

  it("returns delay within expected range for decorrelated-jitter", () => {
    for (let i = 0; i < 50; i++) {
      const delay = computeDelay("decorrelated-jitter", 100, 30_000, 1, 200);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThanOrEqual(600); // min(30000, 200*3)
    }
  });

  it("never exceeds maxDelayMs for decorrelated-jitter", () => {
    for (let i = 0; i < 50; i++) {
      const delay = computeDelay("decorrelated-jitter", 100, 300, 5, 5000);
      expect(delay).toBeLessThanOrEqual(300);
    }
  });
});
