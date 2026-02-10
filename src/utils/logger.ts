export type LogLevel = "info" | "warn" | "error" | "debug";

export interface LogContext {
  [key: string]: string | number | boolean | null | undefined;
}

export interface Logger {
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  debug: (message: string, context?: LogContext) => void;
}

// ---------------------------------------------------------------------------
// Internal formatting
// ---------------------------------------------------------------------------

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  elapsedMs: number;
  message: string;
  context?: LogContext;
}

const COLORS = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERR!",
  debug: "DEBG",
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
  debug: COLORS.gray,
};

function useColor(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatContextPairs(ctx: LogContext): string {
  return Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

function formatHuman(entry: LogEntry, colorEnabled: boolean): string {
  const ts = `[${entry.timestamp}]`;
  const elapsed = `+${formatElapsed(entry.elapsedMs)}`;
  const prefix = LEVEL_LABELS[entry.level];
  const ctxStr = entry.context ? ` ${formatContextPairs(entry.context)}` : "";

  if (colorEnabled) {
    const lc = LEVEL_COLORS[entry.level];
    return [
      `${COLORS.gray}${ts} ${elapsed}${COLORS.reset}`,
      `${lc}${COLORS.bold}${prefix}${COLORS.reset}`,
      `${lc}${entry.message}${COLORS.reset}`,
      ctxStr ? `${COLORS.cyan}${ctxStr}${COLORS.reset}` : ""
    ]
      .filter(Boolean)
      .join(" ");
  }

  return `${ts} ${elapsed} ${prefix} ${entry.message}${ctxStr}`;
}

function formatStructured(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a structured logger with elapsed-time tracking and optional
 * key–value context on every line.
 *
 * Output format is controlled by `WQG_LOG_FORMAT`:
 *  - `"json"` → newline-delimited JSON (machine-readable, ideal for CI).
 *  - anything else → human-readable with optional ANSI colour.
 */
export function createLogger(verbose: boolean): Logger {
  const colorEnabled = useColor();
  const structured = process.env.WQG_LOG_FORMAT === "json";
  const startTime = Date.now(); // Date.now so vi.useFakeTimers works

  function emit(level: LogLevel, message: string, context?: LogContext): void {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - startTime,
      message,
      ...(context && Object.keys(context).length > 0 ? { context } : {})
    };

    const formatted = structured ? formatStructured(entry) : formatHuman(entry, colorEnabled);

    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  return {
    info: (message, context?) => emit("info", message, context),
    warn: (message, context?) => emit("warn", message, context),
    error: (message, context?) => emit("error", message, context),
    debug: (message, context?) => {
      if (verbose) {
        emit("debug", message, context);
      }
    }
  };
}
