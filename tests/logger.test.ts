import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/utils/logger.js";

function setTTY(value: boolean) {
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true
  });
}

describe("logger utilities", () => {
  const originalNoColor = process.env.NO_COLOR;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-08T01:02:03.004Z"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    delete process.env.NO_COLOR;
  });

  afterEach(() => {
    vi.useRealTimers();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();

    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
  });

  it("logs colored output when TTY is enabled", () => {
    setTTY(true);
    const logger = createLogger(false);

    logger.info("hello");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("\x1b[90m[2026-02-08T01:02:03.004Z]\x1b[0m");
    expect(payload).toContain("\x1b[32mhello\x1b[0m");
  });

  it("logs plain output when TTY is disabled", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.warn("careful");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = String(warnSpy.mock.calls[0]?.[0]);
    expect(payload).toBe("[2026-02-08T01:02:03.004Z] careful");
  });

  it("disables color output when NO_COLOR is set", () => {
    setTTY(true);
    process.env.NO_COLOR = "1";
    const logger = createLogger(false);

    logger.error("failed");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = String(errorSpy.mock.calls[0]?.[0]);
    expect(payload).toBe("[2026-02-08T01:02:03.004Z] failed");
  });

  it("prints debug messages only in verbose mode", () => {
    setTTY(false);
    const quiet = createLogger(false);
    const verbose = createLogger(true);

    quiet.debug("hidden");
    verbose.debug("visible");

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[2026-02-08T01:02:03.004Z] visible");
  });

  it("routes warn and error to the expected console methods", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.warn("warn-path");
    logger.error("error-path");

    expect(warnSpy).toHaveBeenCalledWith("[2026-02-08T01:02:03.004Z] warn-path");
    expect(errorSpy).toHaveBeenCalledWith("[2026-02-08T01:02:03.004Z] error-path");
  });

  it("emits timestamp for info logs", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.info("hello-info");

    expect(logSpy).toHaveBeenCalledWith("[2026-02-08T01:02:03.004Z] hello-info");
  });

  it("renders debug in gray when color is enabled", () => {
    setTTY(true);
    const logger = createLogger(true);

    logger.debug("dbg");

    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("\x1b[90m");
    expect(payload).toContain("dbg");
  });
});
