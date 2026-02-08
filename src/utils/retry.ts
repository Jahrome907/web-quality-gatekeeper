import type { Logger } from "./logger.js";

interface RetryOptions {
  retries: number;
  delayMs: number;
  logger?: Logger;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { retries, delayMs, logger } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        logger?.warn(
          `Attempt ${attempt + 1} failed, retrying in ${delayMs}ms: ${(error as Error).message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}
