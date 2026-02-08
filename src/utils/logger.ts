export type LogLevel = "info" | "warn" | "error" | "debug";

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

const COLORS = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  reset: "\x1b[0m",
};

function useColor(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

function timestamp(): string {
  return `[${new Date().toISOString()}]`;
}

function format(color: string, message: string, colorEnabled: boolean): string {
  const ts = timestamp();
  if (colorEnabled) {
    return `${COLORS.gray}${ts}${COLORS.reset} ${color}${message}${COLORS.reset}`;
  }
  return `${ts} ${message}`;
}

export function createLogger(verbose: boolean): Logger {
  const colorEnabled = useColor();

  return {
    info: (message) => console.log(format(COLORS.green, message, colorEnabled)),
    warn: (message) => console.warn(format(COLORS.yellow, message, colorEnabled)),
    error: (message) => console.error(format(COLORS.red, message, colorEnabled)),
    debug: (message) => {
      if (verbose) {
        console.log(format(COLORS.gray, message, colorEnabled));
      }
    }
  };
}
