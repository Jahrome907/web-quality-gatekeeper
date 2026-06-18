import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn()
}));
const mockLaunch = vi.fn();
const mockRetry = vi.fn();
const mockEnsureDir = vi.fn();
const ORIGINAL_CHROME_PATH = process.env.CHROME_PATH;

vi.mock("playwright", () => ({
  chromium: {
    launch: mockLaunch
  }
}));
vi.mock("node:dns/promises", () => ({
  lookup: mockLookup
}));
vi.mock("../src/utils/retry.js", () => ({
  retry: mockRetry
}));
vi.mock("../src/utils/fs.js", async () => {
  const actual = await vi.importActual("../src/utils/fs.js");
  return {
    ...actual,
    ensureDir: mockEnsureDir
  };
});

function createPageDouble() {
  let evaluateCallCount = 0;
  return {
    on: vi.fn(),
    setDefaultNavigationTimeout: vi.fn(),
    setDefaultTimeout: vi.fn(),
    goto: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue("https://example.com/"),
    addStyleTag: vi.fn().mockResolvedValue(undefined),
    emulateMedia: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    evaluate: vi.fn().mockImplementation(async () => {
      evaluateCallCount += 1;
      // First evaluate call reads document height, subsequent calls are scroll operations.
      return evaluateCallCount === 1 ? 3600 : undefined;
    })
  };
}

describe("playwright runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CHROME_PATH;
    mockRetry.mockImplementation(async (fn: () => unknown) => fn());
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "app.example.com") {
        return [{ address: "203.0.113.12", family: 4 }];
      }
      if (hostname === "www.example.com") {
        return [{ address: "203.0.113.11", family: 4 }];
      }
      return [{ address: "203.0.113.10", family: 4 }];
    });
  });

  afterEach(() => {
    if (ORIGINAL_CHROME_PATH === undefined) {
      delete process.env.CHROME_PATH;
    } else {
      process.env.CHROME_PATH = ORIGINAL_CHROME_PATH;
    }
  });

  it("opens page with auth headers and cookies", async () => {
    const page = createPageDouble();
    const addCookies = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue(page);
    let routeHandler:
      | ((route: {
          request: () => {
            isNavigationRequest: () => boolean;
            url: () => string;
            headers: () => Record<string, string>;
          };
          abort: (reason?: string) => Promise<void>;
          continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
        }) => Promise<void>)
      | null = null;
    const route = vi.fn().mockImplementation(async (_matcher, handler) => {
      routeHandler = handler;
    });
    const newContext = vi.fn().mockResolvedValue({
      addCookies,
      newPage,
      route
    });
    mockLaunch.mockResolvedValue({
      newContext
    });

    const logger = { debug: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");
    const result = await openPage(
      "https://example.com",
      {
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
        retries: { count: 2, delayMs: 10 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "wqg/3.0.0",
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
      } as never,
      logger as never,
      {
        headers: { "X-WQG-Auth": "Token token-123" },
        cookies: [{ name: "wqg_session", value: "abc123" }]
      },
      {
        hostResolverRules: "MAP example.com 203.0.113.10"
      }
    );

    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10"]
    });
    expect(newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 1280, height: 720 },
        userAgent: "wqg/3.0.0",
        locale: "en-US",
        colorScheme: "light"
      })
    );
    expect(route).toHaveBeenCalledWith("**", expect.any(Function));
    expect(addCookies).toHaveBeenCalledWith([
      {
        name: "wqg_session",
        value: "abc123",
        url: "https://example.com/"
      }
    ]);
    const continueRequest = vi.fn().mockResolvedValue(undefined);
    const handler = routeHandler as unknown as (
      route: {
        request: () => {
          isNavigationRequest: () => boolean;
          url: () => string;
          headers: () => Record<string, string>;
        };
        abort: (reason?: string) => Promise<void>;
        continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
      }
    ) => Promise<void>;
    if (!handler) {
      throw new Error("route handler not registered");
    }
    await handler({
      request: () => ({
        isNavigationRequest: () => true,
        url: () => "https://example.com/",
        headers: () => ({ Accept: "text/html" })
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      continue: continueRequest
    });
    expect(continueRequest).toHaveBeenCalledWith({
      headers: {
        Accept: "text/html",
        "X-WQG-Auth": "Token token-123"
      }
    });
    const crossOriginContinue = vi.fn().mockResolvedValue(undefined);
    await handler({
      request: () => ({
        isNavigationRequest: () => false,
        url: () => "https://cdn.example.net/app.js",
        headers: () => ({ "x-wqg-auth": "Token token-123", Accept: "*/*" })
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      continue: crossOriginContinue
    });
    expect(crossOriginContinue).toHaveBeenCalledWith({
      headers: {
        Accept: "*/*"
      }
    });
    expect(page.on).toHaveBeenCalledWith("console", expect.any(Function));
    expect(page.on).toHaveBeenCalledWith("request", expect.any(Function));
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxRetries: 2,
        baseDelayMs: 10,
        logger,
        isRetryable: expect.any(Function)
      })
    );
    expect(result.runtimeSignals.snapshot()).toEqual({
      console: {
        total: 0,
        errorCount: 0,
        warningCount: 0,
        dropped: 0,
        messages: []
      },
      jsErrors: {
        total: 0,
        dropped: 0,
        errors: []
      },
      network: {
        totalRequests: 0,
        failedRequests: 0,
        transferSizeBytes: 0,
        resourceTypeBreakdown: {}
      }
    });
    expect(result.resolvedUrl).toBe("https://example.com/");
    expect(result.resolvedHostResolverRules).toBeNull();
  });

  it("propagates browser launch failures", async () => {
    mockLaunch.mockRejectedValue(new Error("browser launch failed"));

    const logger = { debug: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    await expect(
      openPage(
        "https://example.com",
        {
          timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
          playwright: {
            viewport: { width: 1280, height: 720 },
            userAgent: "wqg/3.0.0",
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
        } as never,
        logger as never
      )
    ).rejects.toThrow("browser launch failed");
  });

  it("uses CHROME_PATH when a system Chrome is provided", async () => {
    process.env.CHROME_PATH = process.platform === "win32" ? "C:\\Windows\\notepad.exe" : "/bin/sh";
    const page = createPageDouble();
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page)
    });
    mockLaunch.mockResolvedValue({
      newContext
    });

    const logger = { debug: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    await openPage(
      "https://example.com",
      {
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "wqg/3.0.0",
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
      } as never,
      logger as never
    );

    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      executablePath: process.env.CHROME_PATH
    });
    expect(logger.debug).toHaveBeenCalledWith(`Using Chrome at: ${process.env.CHROME_PATH}`);
  });

  it("cleans up browser resources when initial navigation fails", async () => {
    const page = createPageDouble();
    page.goto.mockRejectedValue(new Error("navigation failed"));
    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);

    const newPage = vi.fn().mockResolvedValue({
      ...page,
      close: closePage
    });
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage,
      close: closeContext
    });
    mockLaunch.mockResolvedValue({
      newContext,
      close: closeBrowser
    });

    const logger = { debug: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    await expect(
      openPage(
        "https://example.com",
        {
          timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
          playwright: {
            viewport: { width: 1280, height: 720 },
            userAgent: "wqg/3.0.0",
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
        } as never,
        logger as never
      )
    ).rejects.toThrow("navigation failed");

    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("blocks redirected internal navigation targets in sensitive mode", async () => {
    const page = createPageDouble();
    let routeHandler: ((route: { request: () => { isNavigationRequest: () => boolean; url: () => string; headers: () => Record<string, string> }; abort: (reason?: string) => Promise<void>; continue: (overrides?: { headers?: Record<string, string> }) => Promise<void> }) => Promise<void>) | null =
      null;
    const route = vi.fn().mockImplementation(async (_matcher, handler) => {
      routeHandler = handler;
    });
    page.goto.mockImplementation(async () => {
      const abort = vi.fn().mockResolvedValue(undefined);
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          url: () => "http://127.0.0.1:4010/",
          headers: () => ({})
        }),
        abort,
        continue: vi.fn().mockResolvedValue(undefined)
      });
      return undefined;
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      ...page,
      close: closePage
    });
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage,
      route,
      close: closeContext
    });
    mockLaunch.mockResolvedValue({
      newContext,
      close: closeBrowser
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    await expect(
      openPage(
        "https://example.com",
        {
          timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
          retries: { count: 1, delayMs: 10 },
          playwright: {
            viewport: { width: 1280, height: 720 },
            userAgent: "wqg/3.0.0",
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
        } as never,
        logger as never,
        null,
        {
          targetPolicy: {
            allowInternalTargets: false,
            blockInternalTargets: true
          }
        }
      )
    ).rejects.toThrow("Blocked internal navigation target");

    expect(route).toHaveBeenCalledWith("**", expect.any(Function));
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("blocks internal subresource requests in sensitive mode", async () => {
    const page = createPageDouble();
    let routeHandler:
      | ((
          route: {
            request: () => { isNavigationRequest: () => boolean; url: () => string; headers: () => Record<string, string> };
            abort: (reason?: string) => Promise<void>;
            continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
          }
        ) => Promise<void>)
      | null = null;
    const route = vi.fn().mockImplementation(async (_matcher, handler) => {
      routeHandler = handler;
    });
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => false,
          url: () => "http://127.0.0.1:4010/private-script.js",
          headers: () => ({})
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined)
      });
      return undefined;
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue({
      ...page,
      close: closePage
    });
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage,
      route,
      close: closeContext
    });
    mockLaunch.mockResolvedValue({
      newContext,
      close: closeBrowser
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    await expect(
      openPage(
        "https://example.com",
        {
          timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
          retries: { count: 1, delayMs: 10 },
          playwright: {
            viewport: { width: 1280, height: 720 },
            userAgent: "wqg/3.0.0",
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
        } as never,
        logger as never,
        null,
        {
          targetPolicy: {
            allowInternalTargets: false,
            blockInternalTargets: true
          }
        }
      )
    ).rejects.toThrow("Blocked internal request target");

    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("does not re-resolve a previously trusted host during same-host navigations", async () => {
    const page = createPageDouble();
    let routeHandler:
      | ((
          route: {
            request: () => { isNavigationRequest: () => boolean; url: () => string; headers: () => Record<string, string> };
            abort: (reason?: string) => Promise<void>;
            continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
          }
        ) => Promise<void>)
      | null = null;
    const route = vi.fn().mockImplementation(async (_matcher, handler) => {
      routeHandler = handler;
    });
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          url: () => "https://example.com/dashboard",
          headers: () => ({})
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined)
      });
      return undefined;
    });

    const newPage = vi.fn().mockResolvedValue(page);
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage,
      route
    });
    mockLaunch.mockResolvedValue({
      newContext
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    const result = await openPage(
      "https://example.com",
      {
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
        retries: { count: 1, delayMs: 10 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "wqg/3.0.0",
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
      } as never,
      logger as never,
      null,
      {
        hostResolverRules: "MAP example.com 203.0.113.10",
        targetPolicy: {
          allowInternalTargets: false,
          blockInternalTargets: true
        }
      }
    );

    expect(result.resolvedUrl).toBe("https://example.com/");
    expect(result.resolvedHostResolverRules).toBe("MAP example.com 203.0.113.10");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("re-resolves repeated newly discovered subresource hosts before continuing requests", async () => {
    const page = createPageDouble();
    type TestRouteHandler = (route: {
      request: () => { isNavigationRequest: () => boolean; url: () => string; headers: () => Record<string, string> };
      abort: (reason?: string) => Promise<void>;
      continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
    }) => Promise<void>;
    let routeHandler:
      | TestRouteHandler
      | null = null;
    const route = vi.fn().mockImplementation(async (_matcher, handler) => {
      routeHandler = handler;
    });
    const newPage = vi.fn().mockResolvedValue(page);
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage,
      route
    });
    mockLaunch.mockResolvedValue({
      newContext
    });
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "assets.example.com") {
        const calls = mockLookup.mock.calls.filter((call) => call[0] === hostname).length;
        return [{ address: calls === 1 ? "203.0.113.20" : "10.0.0.7", family: 4 }];
      }
      return [{ address: "203.0.113.10", family: 4 }];
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    await openPage(
      "https://example.com",
      {
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
        retries: { count: 1, delayMs: 10 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "wqg/3.0.0",
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
      } as never,
      logger as never,
      null,
      {
        hostResolverRules: "MAP example.com 203.0.113.10",
        targetPolicy: {
          allowInternalTargets: false,
          blockInternalTargets: true
        }
      }
    );

    if (!routeHandler) {
      throw new Error("route handler not registered");
    }
    const handler = routeHandler as unknown as TestRouteHandler;
    const firstContinue = vi.fn().mockResolvedValue(undefined);
    await handler({
      request: () => ({
        isNavigationRequest: () => false,
        url: () => "https://assets.example.com/app.js",
        headers: () => ({ Accept: "*/*" })
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      continue: firstContinue
    });
    expect(firstContinue).toHaveBeenCalledWith({ headers: { Accept: "*/*" } });

    const secondAbort = vi.fn().mockResolvedValue(undefined);
    await handler({
      request: () => ({
        isNavigationRequest: () => false,
        url: () => "https://assets.example.com/app.js",
        headers: () => ({ Accept: "*/*" })
      }),
      abort: secondAbort,
      continue: vi.fn().mockResolvedValue(undefined)
    });

    expect(secondAbort).toHaveBeenCalledWith("blockedbyclient");
    expect(mockLookup.mock.calls.filter((call) => call[0] === "assets.example.com")).toHaveLength(2);
  });

  it("relaunches with landing-host resolver rules before reusing the page after a cross-host redirect", async () => {
    const firstPage = createPageDouble();
    firstPage.url.mockReturnValue("https://www.example.com/");
    const secondPage = createPageDouble();
    secondPage.url.mockReturnValue("https://www.example.com/");

    const closePageOne = vi.fn().mockResolvedValue(undefined);
    const closeContextOne = vi.fn().mockResolvedValue(undefined);
    const closeBrowserOne = vi.fn().mockResolvedValue(undefined);
    const addCookiesOne = vi.fn().mockResolvedValue(undefined);
    const addCookiesTwo = vi.fn().mockResolvedValue(undefined);
    let routeHandlerTwo:
      | ((route: {
          request: () => {
            isNavigationRequest: () => boolean;
            url: () => string;
            headers: () => Record<string, string>;
          };
          abort: (reason?: string) => Promise<void>;
          continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
        }) => Promise<void>)
      | null = null;

    const newContextOne = vi.fn().mockResolvedValue({
      addCookies: addCookiesOne,
      newPage: vi.fn().mockResolvedValue({
        ...firstPage,
        close: closePageOne
      }),
      route: vi.fn().mockResolvedValue(undefined),
      close: closeContextOne
    });
    const newContextTwo = vi.fn().mockResolvedValue({
      addCookies: addCookiesTwo,
      newPage: vi.fn().mockResolvedValue(secondPage),
      route: vi.fn().mockImplementation(async (_matcher, handler) => {
        routeHandlerTwo = handler;
      })
    });

    mockLaunch
      .mockResolvedValueOnce({
        newContext: newContextOne,
        close: closeBrowserOne
      })
      .mockResolvedValueOnce({
        newContext: newContextTwo
      });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    const result = await openPage(
      "https://example.com",
      {
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
        retries: { count: 1, delayMs: 10 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "wqg/3.0.0",
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
      } as never,
      logger as never,
      {
        headers: { "X-WQG-Auth": "Token token-123" },
        cookies: [{ name: "wqg_session", value: "abc123" }]
      },
      {
        hostResolverRules: "MAP example.com 203.0.113.10",
        targetPolicy: {
          allowInternalTargets: false,
          blockInternalTargets: true
        }
      }
    );

    expect(mockLaunch).toHaveBeenNthCalledWith(1, {
      headless: true,
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10"]
    });
    expect(mockLaunch).toHaveBeenNthCalledWith(2, {
      headless: true,
      args: ["--host-resolver-rules=MAP www.example.com 203.0.113.11"]
    });
    expect(closePageOne).toHaveBeenCalledTimes(1);
    expect(closeContextOne).toHaveBeenCalledTimes(1);
    expect(closeBrowserOne).toHaveBeenCalledTimes(1);
    expect(addCookiesOne).toHaveBeenCalledWith([
      {
        name: "wqg_session",
        value: "abc123",
        url: "https://example.com/"
      }
    ]);
    expect(addCookiesTwo).toHaveBeenCalledWith([
      {
        name: "wqg_session",
        value: "abc123",
        url: "https://example.com/"
      }
    ]);
    const redirectedContinue = vi.fn().mockResolvedValue(undefined);
    const redirectedHandler = routeHandlerTwo as unknown as (
      route: {
        request: () => {
          isNavigationRequest: () => boolean;
          url: () => string;
          headers: () => Record<string, string>;
        };
        abort: (reason?: string) => Promise<void>;
        continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
      }
    ) => Promise<void>;
    if (!redirectedHandler) {
      throw new Error("redirected route handler not registered");
    }
    await redirectedHandler({
      request: () => ({
        isNavigationRequest: () => true,
        url: () => "https://www.example.com/",
        headers: () => ({ "x-wqg-auth": "Token token-123", Accept: "text/html" })
      }),
      abort: vi.fn().mockResolvedValue(undefined),
      continue: redirectedContinue
    });
    expect(redirectedContinue).toHaveBeenCalledWith({
      headers: {
        Accept: "text/html"
      }
    });
    expect(result.page).toBe(secondPage as never);
    expect(result.resolvedUrl).toBe("https://www.example.com/");
    expect(result.resolvedHostResolverRules).toBe("MAP www.example.com 203.0.113.11");
  });

  it("keeps relaunching until landing-host resolver rules stabilize", async () => {
    const firstPage = createPageDouble();
    firstPage.url.mockReturnValue("https://www.example.com/");
    const secondPage = createPageDouble();
    secondPage.url.mockReturnValue("https://app.example.com/");
    const thirdPage = createPageDouble();
    thirdPage.url.mockReturnValue("https://app.example.com/");

    const closePageOne = vi.fn().mockResolvedValue(undefined);
    const closeContextOne = vi.fn().mockResolvedValue(undefined);
    const closeBrowserOne = vi.fn().mockResolvedValue(undefined);
    const closePageTwo = vi.fn().mockResolvedValue(undefined);
    const closeContextTwo = vi.fn().mockResolvedValue(undefined);
    const closeBrowserTwo = vi.fn().mockResolvedValue(undefined);

    const newContextOne = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({
        ...firstPage,
        close: closePageOne
      }),
      route: vi.fn().mockResolvedValue(undefined),
      close: closeContextOne
    });
    const newContextTwo = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({
        ...secondPage,
        close: closePageTwo
      }),
      route: vi.fn().mockResolvedValue(undefined),
      close: closeContextTwo
    });
    const newContextThree = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(thirdPage),
      route: vi.fn().mockResolvedValue(undefined)
    });

    mockLaunch
      .mockResolvedValueOnce({
        newContext: newContextOne,
        close: closeBrowserOne
      })
      .mockResolvedValueOnce({
        newContext: newContextTwo,
        close: closeBrowserTwo
      })
      .mockResolvedValueOnce({
        newContext: newContextThree
      });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { openPage } = await import("../src/runner/playwright.js");

    const result = await openPage(
      "https://example.com",
      {
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 250 },
        retries: { count: 1, delayMs: 10 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "wqg/3.0.0",
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
      } as never,
      logger as never,
      null,
      {
        hostResolverRules: "MAP example.com 203.0.113.10",
        targetPolicy: {
          allowInternalTargets: false,
          blockInternalTargets: true
        }
      }
    );

    expect(mockLaunch).toHaveBeenCalledTimes(3);
    expect(mockLaunch).toHaveBeenNthCalledWith(1, {
      headless: true,
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10"]
    });
    expect(mockLaunch).toHaveBeenNthCalledWith(2, {
      headless: true,
      args: ["--host-resolver-rules=MAP www.example.com 203.0.113.11"]
    });
    expect(mockLaunch).toHaveBeenNthCalledWith(3, {
      headless: true,
      args: ["--host-resolver-rules=MAP app.example.com 203.0.113.12"]
    });
    expect(closePageOne).toHaveBeenCalledTimes(1);
    expect(closeContextOne).toHaveBeenCalledTimes(1);
    expect(closeBrowserOne).toHaveBeenCalledTimes(1);
    expect(closePageTwo).toHaveBeenCalledTimes(1);
    expect(closeContextTwo).toHaveBeenCalledTimes(1);
    expect(closeBrowserTwo).toHaveBeenCalledTimes(1);
    expect(result.page).toBe(thirdPage as never);
    expect(result.resolvedUrl).toBe("https://app.example.com/");
    expect(result.resolvedHostResolverRules).toBe("MAP app.example.com 203.0.113.12");
  });

  it("captures configured screenshots deterministically", async () => {
    const page = createPageDouble();

    const logger = { debug: vi.fn() };
    const { captureScreenshots } = await import("../src/runner/playwright.js");
    const outDir = path.resolve(process.cwd(), "artifacts/screenshots");
    const results = await captureScreenshots(
      page as never,
      "https://example.com",
      {
        retries: { count: 2, delayMs: 15 },
        screenshots: [
          {
            name: "Home Page",
            path: "/",
            fullPage: true,
            waitForSelector: "#app",
            waitForTimeoutMs: 100
          }
        ]
      } as never,
      outDir,
      logger as never
    );

    expect(mockEnsureDir).toHaveBeenCalledWith(outDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.path).toBe(path.join(outDir, "home-page.png"));
    expect(results[0]!.url).toBe("https://example.com/");
    expect(page.goto).toHaveBeenCalledWith("https://example.com/", { waitUntil: "load" });
    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "home-page.png"),
      fullPage: true,
      animations: "disabled"
    });
    expect(page.waitForSelector).toHaveBeenCalledWith("#app", { timeout: 10000 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(100);
    expect(page.addStyleTag).toHaveBeenCalledTimes(1);
    expect(page.emulateMedia).toHaveBeenCalledWith({ reducedMotion: "reduce" });
    expect(mockRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxRetries: 2,
        baseDelayMs: 15,
        logger,
        isRetryable: expect.any(Function)
      })
    );
  });

  it("keeps colliding sanitized screenshot names in distinct files", async () => {
    const page = createPageDouble();
    const logger = { debug: vi.fn() };
    const { captureScreenshots } = await import("../src/runner/playwright.js");
    const outDir = path.resolve(process.cwd(), "artifacts/screenshots");

    const results = await captureScreenshots(
      page as never,
      "https://example.com",
      {
        retries: { count: 1, delayMs: 5 },
        screenshots: [
          { name: "Home Page", path: "/", fullPage: true },
          { name: "Home@Page", path: "/pricing", fullPage: true },
          { name: "!!!", path: "/contact", fullPage: true }
        ]
      } as never,
      outDir,
      logger as never
    );

    expect(results.map((result) => path.basename(result.path))).toEqual([
      "home-page.png",
      "home-page-02.png",
      "---.png"
    ]);
    expect(new Set(results.map((result) => result.path)).size).toBe(results.length);
    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "home-page-02.png"),
      fullPage: true,
      animations: "disabled"
    });
  });

  it("captures additional viewport screenshots when screenshot gallery mode is enabled", async () => {
    const page = createPageDouble();
    const logger = { debug: vi.fn() };
    const { captureScreenshots } = await import("../src/runner/playwright.js");
    const outDir = path.resolve(process.cwd(), "artifacts/screenshots");

    const results = await captureScreenshots(
      page as never,
      "https://example.com",
      {
        retries: { count: 1, delayMs: 5 },
        screenshots: [
          {
            name: "Landing",
            path: "/",
            fullPage: true
          }
        ],
        screenshotGallery: {
          enabled: true,
          maxScreenshotsPerPath: 5
        }
      } as never,
      outDir,
      logger as never
    );

    expect(results).toHaveLength(5);
    expect(results[0]!.name).toBe("Landing");
    expect(results[1]!.name).toBe("Landing viewport 1");
    expect(results[4]!.name).toBe("Landing viewport 4");
    expect(results[4]!.path).toBe(path.join(outDir, "landing--vp-04.png"));

    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "landing.png"),
      fullPage: true,
      animations: "disabled"
    });
    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "landing--vp-01.png"),
      fullPage: false,
      animations: "disabled"
    });
    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "landing--vp-04.png"),
      fullPage: false,
      animations: "disabled"
    });
  });

  it("supports high-volume screenshot galleries for report rendering", async () => {
    const page = createPageDouble();
    const logger = { debug: vi.fn() };
    const { captureScreenshots } = await import("../src/runner/playwright.js");
    const outDir = path.resolve(process.cwd(), "artifacts/screenshots");

    const results = await captureScreenshots(
      page as never,
      "https://example.com",
      {
        retries: { count: 1, delayMs: 5 },
        screenshots: [
          {
            name: "Landing",
            path: "/",
            fullPage: true
          }
        ],
        screenshotGallery: {
          enabled: true,
          maxScreenshotsPerPath: 20
        }
      } as never,
      outDir,
      logger as never
    );

    expect(results).toHaveLength(20);
    expect(results[19]!.name).toBe("Landing viewport 19");
    expect(results[19]!.path).toBe(path.join(outDir, "landing--vp-19.png"));
  });
});
