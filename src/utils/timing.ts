import { performance } from "node:perf_hooks";

/** Returns the current time as an ISO 8601 string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Returns elapsed wall-clock milliseconds since `start` (from `Date.now()`). */
export function durationMs(start: number): number {
  return Date.now() - start;
}

// ---------------------------------------------------------------------------
// High-resolution Timer
// ---------------------------------------------------------------------------

export interface TimerCheckpoint {
  name: string;
  elapsedMs: number;
}

export interface TimerResult {
  label: string;
  totalMs: number;
  checkpoints: TimerCheckpoint[];
}

/** Round to three decimal places for readable sub-ms precision. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * High-resolution scoped timer backed by `performance.now()`.
 *
 * Provides sub-millisecond precision timing with labelled checkpoints —
 * useful for profiling individual audit steps without external dependencies.
 *
 * @example
 * ```ts
 * const t = Timer.start("lighthouse");
 * await runLighthouse();
 * t.checkpoint("lhr-received");
 * await extractMetrics();
 * const result = t.finish(); // { label, totalMs, checkpoints }
 * ```
 */
export class Timer {
  readonly label: string;
  private readonly origin: number;
  private readonly points: TimerCheckpoint[] = [];
  private endTime: number | null = null;

  private constructor(label: string) {
    this.label = label;
    this.origin = performance.now();
  }

  /** Create and start a new timer with the given label. */
  static start(label: string): Timer {
    return new Timer(label);
  }

  /** Record a named checkpoint with elapsed time since start. */
  checkpoint(name: string): this {
    if (this.endTime !== null) {
      throw new Error(`Timer "${this.label}" is already finished`);
    }
    this.points.push({ name, elapsedMs: round3(performance.now() - this.origin) });
    return this;
  }

  /** Get current elapsed time without finishing the timer. */
  elapsed(): number {
    return round3(performance.now() - this.origin);
  }

  /** Finish the timer and return the result. Throws on double-finish. */
  finish(): TimerResult {
    if (this.endTime !== null) {
      throw new Error(`Timer "${this.label}" is already finished`);
    }
    this.endTime = performance.now();
    return {
      label: this.label,
      totalMs: round3(this.endTime - this.origin),
      checkpoints: this.points.slice()
    };
  }
}
