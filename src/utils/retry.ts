import type { Logger } from "./logger.js";

/**
 * Backoff strategy for retry delay calculation.
 *
 * - **fixed** — constant delay between attempts.
 * - **exponential** — doubles the delay each attempt, capped at `maxDelayMs`.
 * - **decorrelated-jitter** — AWS-style decorrelated jitter that avoids
 *   thundering-herd failures by randomising each delay independently.
 *   `sleep = min(cap, random_between(base, prev_sleep × 3))`
 *   Ref: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
export type RetryStrategy = "fixed" | "exponential" | "decorrelated-jitter";

export interface RetryOptions {
  /** Maximum retry attempts after the initial call (0 = no retries). */
  maxRetries: number;
  /** Base delay in milliseconds between retries. */
  baseDelayMs: number;
  /** Upper bound on computed delay (default 30 000 ms). */
  maxDelayMs?: number;
  /** Backoff strategy (default `"decorrelated-jitter"`). */
  strategy?: RetryStrategy;
  /** Logger for retry-attempt warnings. */
  logger?: Logger;
  /** Return `false` to fail immediately without further retries. */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Computes the next sleep duration for the given strategy.
 *
 * Exported for unit-testing; not intended for direct consumer use.
 */
export function computeDelay(
  strategy: RetryStrategy,
  baseDelayMs: number,
  maxDelayMs: number,
  attempt: number,
  previousDelay: number
): number {
  switch (strategy) {
    case "fixed":
      return baseDelayMs;
    case "exponential":
      return Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    case "decorrelated-jitter": {
      const ceiling = Math.min(maxDelayMs, previousDelay * 3);
      return Math.max(
        baseDelayMs,
        Math.floor(Math.random() * (ceiling - baseDelayMs + 1) + baseDelayMs)
      );
    }
  }
}

/**
 * Retries an async function with configurable backoff.
 *
 * The default strategy (`decorrelated-jitter`) is production-grade and
 * prevents thundering-herd problems in distributed CI environments.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxRetries,
    baseDelayMs,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    strategy = "decorrelated-jitter",
    logger,
    isRetryable
  } = options;

  let lastError: unknown;
  let previousDelay = baseDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (isRetryable && !isRetryable(error)) {
        throw error;
      }

      if (attempt < maxRetries) {
        const delay = computeDelay(strategy, baseDelayMs, maxDelayMs, attempt, previousDelay);
        previousDelay = delay;
        logger?.warn(
          `Attempt ${attempt + 1}/${maxRetries} failed (next in ${delay}ms): ${(error as Error).message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
