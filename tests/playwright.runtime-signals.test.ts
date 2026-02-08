import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLaunch = vi.fn();
const mockRetry = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch: mockLaunch
  }
}));
vi.mock("../src/utils/retry.js", () => ({
  retry: mockRetry
}));

type Handler = (...args: unknown[]) => void;

function createPageHarness() {
  const handlers = new Map<string, Handler[]>();

  const page = {
    on: vi.fn((event: string, callback: Handler) => {
      const existing = handlers.get(event) ?? [];
      handlers.set(event, [...existing, callback]);
      return page;
    }),
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    addStyleTag: vi.fn().mockResolvedValue(undefined),
    emulateMedia: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined)
  };

  function emit(event: string, payload?: unknown) {
    const callbacks = handlers.get(event) ?? [];
    for (const callback of callbacks) {
      callback(payload);
    }
  }

  return { page, emit };
}

function createConfig() {
  return {
    timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
    playwright: {
      viewport: { width: 1280, height: 720 },
      userAgent: "wqg/0.3.0",
      locale: "en-US",
      colorScheme: "light"
    },
    screenshots: [{ name: "home", path: "/", fullPage: true }],
    lighthouse: {
      budgets: { performance: 0.8, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      formFactor: "desktop"
    },
    visual: { threshold: 0.01 },
    toggles: { a11y: true, perf: true, visual: true }
  };
}

function consoleMessage(type: string, text: string, location?: { url?: string; lineNumber?: number; columnNumber?: number }) {
  return {
    type: () => type,
    text: () => text,
    location: () => location ?? {}
  };
}

describe("runtime signal extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRetry.mockImplementation(async (fn: () => unknown) => fn());
  });

  it("collects and summarizes console/network/js error signals", async () => {
    const harness = createPageHarness();
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue(harness.page)
      })
    });

    const { openPage } = await import("../src/runner/playwright.js");
    const { runtimeSignals } = await openPage(
      "https://example.com",
      createConfig() as never,
      { debug: vi.fn() } as never
    );

    harness.emit("console", consoleMessage("error", "Error line one\nline two", { url: "https://example.com/app.js", lineNumber: 10, columnNumber: 20 }));
    harness.emit("console", consoleMessage("warning", "Warn message"));
    harness.emit("request", { resourceType: () => "script" });
    harness.emit("request", { resourceType: () => "image" });
    harness.emit("requestfailed");
    harness.emit("response", { headers: () => ({ "content-length": "1200" }) });
    harness.emit("response", { headers: () => ({ "content-length": "invalid" }) });
    harness.emit("pageerror", new Error("ReferenceError: x is not defined"));

    const snapshot = runtimeSignals.snapshot();
    expect(snapshot.console).toEqual({
      total: 2,
      errorCount: 1,
      warningCount: 1,
      dropped: 0,
      messages: [
        {
          type: "error",
          text: "Error line one line two",
          location: "https://example.com/app.js:10:20"
        },
        {
          type: "warning",
          text: "Warn message",
          location: null
        }
      ]
    });
    expect(snapshot.jsErrors.total).toBe(1);
    expect(snapshot.jsErrors.dropped).toBe(0);
    expect(snapshot.jsErrors.errors[0]!.message).toBe("ReferenceError: x is not defined");
    expect(snapshot.network).toEqual({
      totalRequests: 2,
      failedRequests: 1,
      transferSizeBytes: 1200,
      resourceTypeBreakdown: {
        image: 1,
        script: 1
      }
    });
  });

  it("caps and truncates collected runtime signal payloads", async () => {
    const harness = createPageHarness();
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue(harness.page)
      })
    });

    const { openPage } = await import("../src/runner/playwright.js");
    const { runtimeSignals } = await openPage(
      "https://example.com",
      createConfig() as never,
      { debug: vi.fn() } as never
    );

    const longText = `${"x".repeat(1100)}\n${"y".repeat(120)}`;
    harness.emit("console", consoleMessage("log", longText, { url: "https://example.com/log.js" }));

    for (let i = 0; i < 204; i += 1) {
      harness.emit("console", consoleMessage("log", `message-${i}`));
    }
    for (let i = 0; i < 105; i += 1) {
      harness.emit("pageerror", new Error(`runtime-${i}`));
    }

    const snapshot = runtimeSignals.snapshot();
    expect(snapshot.console.total).toBe(205);
    expect(snapshot.console.messages).toHaveLength(200);
    expect(snapshot.console.dropped).toBe(5);
    expect(snapshot.console.messages[0]!.text.endsWith("…")).toBe(true);
    expect(snapshot.console.messages[0]!.text.length).toBe(1001);

    expect(snapshot.jsErrors.total).toBe(105);
    expect(snapshot.jsErrors.errors).toHaveLength(100);
    expect(snapshot.jsErrors.dropped).toBe(5);
  });

  it("returns copy-safe snapshots", async () => {
    const harness = createPageHarness();
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue(harness.page)
      })
    });

    const { openPage } = await import("../src/runner/playwright.js");
    const { runtimeSignals } = await openPage(
      "https://example.com",
      createConfig() as never,
      { debug: vi.fn() } as never
    );

    harness.emit("console", consoleMessage("log", "hello"));
    const first = runtimeSignals.snapshot();
    first.console.messages.push({ type: "log", text: "mutated", location: null });

    const second = runtimeSignals.snapshot();
    expect(second.console.messages).toHaveLength(1);
    expect(second.console.messages[0]!.text).toBe("hello");
  });
});
