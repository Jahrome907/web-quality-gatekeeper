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
  const originalLogFormat = process.env.WQG_LOG_FORMAT;
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
    delete process.env.WQG_LOG_FORMAT;
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
    if (originalLogFormat === undefined) {
      delete process.env.WQG_LOG_FORMAT;
    } else {
      process.env.WQG_LOG_FORMAT = originalLogFormat;
    }
  });

  it("logs colored output with level prefix when TTY is enabled", () => {
    setTTY(true);
    const logger = createLogger(false);

    logger.info("hello");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("[2026-02-08T01:02:03.004Z]");
    expect(payload).toContain("+0ms");
    expect(payload).toContain("INFO");
    expect(payload).toContain("hello");
    expect(payload).toContain("\x1b[32m"); // green for INFO
  });

  it("logs plain output with level prefix when TTY is disabled", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.warn("careful");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = String(warnSpy.mock.calls[0]?.[0]);
    expect(payload).toBe("[2026-02-08T01:02:03.004Z] +0ms WARN careful");
  });

  it("disables color output when NO_COLOR is set", () => {
    setTTY(true);
    process.env.NO_COLOR = "1";
    const logger = createLogger(false);

    logger.error("failed");

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = String(errorSpy.mock.calls[0]?.[0]);
    expect(payload).toBe("[2026-02-08T01:02:03.004Z] +0ms ERR! failed");
  });

  it("prints debug messages only in verbose mode", () => {
    setTTY(false);
    const quiet = createLogger(false);
    const verbose = createLogger(true);

    quiet.debug("hidden");
    verbose.debug("visible");

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("DEBG");
    expect(payload).toContain("visible");
  });

  it("routes warn and error to the expected console methods", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.warn("warn-path");
    logger.error("error-path");

    const warnPayload = String(warnSpy.mock.calls[0]?.[0]);
    const errorPayload = String(errorSpy.mock.calls[0]?.[0]);
    expect(warnPayload).toContain("WARN");
    expect(warnPayload).toContain("warn-path");
    expect(errorPayload).toContain("ERR!");
    expect(errorPayload).toContain("error-path");
  });

  it("emits timestamp and elapsed for info logs", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.info("hello-info");

    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("[2026-02-08T01:02:03.004Z]");
    expect(payload).toContain("+0ms");
    expect(payload).toContain("INFO");
    expect(payload).toContain("hello-info");
  });

  it("renders debug in gray when color is enabled", () => {
    setTTY(true);
    const logger = createLogger(true);

    logger.debug("dbg");

    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("\x1b[90m");
    expect(payload).toContain("dbg");
  });

  it("appends context key-value pairs", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.info("audit started", { url: "https://example.com", step: 1 });

    const payload = String(logSpy.mock.calls[0]?.[0]);
    expect(payload).toContain("audit started");
    expect(payload).toContain("url=https://example.com");
    expect(payload).toContain("step=1");
  });

  it("outputs JSON when WQG_LOG_FORMAT=json", () => {
    setTTY(false);
    process.env.WQG_LOG_FORMAT = "json";
    const logger = createLogger(false);

    logger.info("structured", { target: "page-1" });

    const payload = String(logSpy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(payload);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("structured");
    expect(parsed.context.target).toBe("page-1");
    expect(parsed.elapsedMs).toBe(0);
  });

  it("tracks elapsed time between calls", () => {
    setTTY(false);
    const logger = createLogger(false);

    logger.info("first");
    vi.setSystemTime(new Date("2026-02-08T01:02:04.004Z"));
    logger.info("second");

    const firstPayload = String(logSpy.mock.calls[0]?.[0]);
    const secondPayload = String(logSpy.mock.calls[1]?.[0]);
    expect(firstPayload).toContain("+0ms");
    expect(secondPayload).toContain("+1.0s");
  });
});
