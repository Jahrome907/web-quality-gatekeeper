import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES,
  MAX_RESOLVER_PINNING_HOSTS,
  MAX_RESOLVER_PINNING_RELAUNCHES
} from "../src/runner/resolverPinning.js";

const { mockIsBrowserExecutableFile, mockLookup, mockResolveBrowserExecutablePath } = vi.hoisted(
  () => ({
    mockIsBrowserExecutableFile: vi.fn(),
    mockLookup: vi.fn(),
    mockResolveBrowserExecutablePath: vi.fn()
  })
);
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
vi.mock("../src/utils/browserExecutable.js", () => ({
  isBrowserExecutableFile: mockIsBrowserExecutableFile,
  resolveBrowserExecutablePath: mockResolveBrowserExecutablePath
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

type InterceptedRoute = {
  request: () => {
    isNavigationRequest: () => boolean;
    url: () => string;
    headers: () => Record<string, string>;
  };
  abort: (reason?: string) => Promise<void>;
  continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
};

type InterceptHandler = (route: InterceptedRoute) => Promise<void>;

function createRoutedBrowser() {
  const closePage = vi.fn().mockResolvedValue(undefined);
  const closeContext = vi.fn().mockResolvedValue(undefined);
  const closeBrowser = vi.fn().mockResolvedValue(undefined);
  const page = { ...createPageDouble(), close: closePage };
  let routeHandler: InterceptHandler | null = null;
  const route = vi.fn().mockImplementation(async (_matcher: string, handler: InterceptHandler) => {
    routeHandler = handler;
  });
  const newContext = vi.fn().mockResolvedValue({
    addCookies: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
    route,
    close: closeContext
  });

  return {
    browser: { newContext, close: closeBrowser },
    closeBrowser,
    getRouteHandler: () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      return routeHandler;
    }
  };
}

function auditConfig() {
  return {
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
  } as never;
}

const strictTargetPolicy = {
  allowInternalTargets: false,
  blockInternalTargets: true
};

describe("playwright runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CHROME_PATH;
    mockIsBrowserExecutableFile.mockReturnValue(false);
    mockResolveBrowserExecutablePath.mockReturnValue(undefined);
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
    const handler = routeHandler as unknown as (route: {
      request: () => {
        isNavigationRequest: () => boolean;
        url: () => string;
        headers: () => Record<string, string>;
      };
      abort: (reason?: string) => Promise<void>;
      continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
    }) => Promise<void>;
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

  it("uses CHROME_PATH when a browser executable is provided", async () => {
    process.env.CHROME_PATH =
      process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : "/usr/bin/google-chrome";
    mockIsBrowserExecutableFile.mockReturnValue(true);
    mockResolveBrowserExecutablePath.mockReturnValue(process.env.CHROME_PATH);
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
  it("ignores CHROME_PATH when it is not a browser executable", async () => {
    process.env.CHROME_PATH = process.cwd();
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
      headless: true
    });
    expect(logger.debug).not.toHaveBeenCalledWith(`Using Chrome at: ${process.env.CHROME_PATH}`);
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

  it("rejects an initial navigation when its final response is an HTTP error", async () => {
    const page = createPageDouble();
    page.goto.mockResolvedValue({
      status: () => 404,
      url: () => "https://example.com/missing"
    });
    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
      close: closeContext
    });
    mockLaunch.mockResolvedValue({ newContext, close: closeBrowser });

    const { openPage } = await import("../src/runner/playwright.js");

    await expect(openPage("https://example.com", auditConfig(), { debug: vi.fn() } as never)).rejects.toThrow(
      "Browser navigation failed with HTTP 404 for https://example.com/missing"
    );

    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("accepts the successful final response after an initial redirect", async () => {
    const page = createPageDouble();
    page.goto.mockResolvedValue({
      status: () => 200,
      url: () => "https://www.example.com/"
    });
    page.url.mockReturnValue("https://www.example.com/");
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page)
    });
    mockLaunch.mockResolvedValue({ newContext });

    const { openPage } = await import("../src/runner/playwright.js");
    const result = await openPage("https://example.com", auditConfig(), { debug: vi.fn() } as never);

    expect(result.resolvedUrl).toBe("https://www.example.com/");
  });

  it("blocks redirected internal navigation targets in sensitive mode", async () => {
    const page = createPageDouble();
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
      return {
        status: () => 404,
        url: () => "http://127.0.0.1:4010/"
      };
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

  it("keeps a private subresource fatal after a public request needs resolver pinning", async () => {
    const page = createPageDouble();
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
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => false,
          url: () => "https://cdn.example.net/app.js",
          headers: () => ({})
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined)
      });
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

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("caches concurrent and sequential unresolved requests without pinning or failing the audit", async () => {
    const page = createPageDouble();
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
    const requestAborts = Array.from({ length: 3 }, () => vi.fn().mockResolvedValue(undefined));
    const requestContinues = Array.from({ length: 3 }, () => vi.fn().mockResolvedValue(undefined));
    page.waitForTimeout.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      const routeRequest = (index: number) => ({
        request: () => ({
          isNavigationRequest: () => false,
          url: () => "https://unresolved.example.net/challenge.js",
          headers: () => ({})
        }),
        abort: requestAborts[index]!,
        continue: requestContinues[index]!
      });
      await Promise.all([routeHandler(routeRequest(0)), routeHandler(routeRequest(1))]);
      await routeHandler(routeRequest(2));
    });
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "unresolved.example.net") {
        throw new Error("ENOTFOUND");
      }
      return [{ address: "203.0.113.10", family: 4 }];
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
        route,
        close: closeContext
      }),
      close: closeBrowser
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
        targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
      }
    );

    expect(result.resolvedUrl).toBe("https://example.com/");
    expect(
      mockLookup.mock.calls.filter(([hostname]) => hostname === "unresolved.example.net")
    ).toHaveLength(1);
    requestAborts.forEach((requestAbort) =>
      expect(requestAbort).toHaveBeenCalledWith("blockedbyclient")
    );
    requestContinues.forEach((requestContinue) => expect(requestContinue).not.toHaveBeenCalled());
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Blocked unresolved non-navigation Playwright request: unresolved.example.net. DNS resolution failed during SSRF safety checks."
    );

    await result.page.close();
    await result.browser.close();
  });

  it("keeps a navigation to a cached unresolved host fatal", async () => {
    const page = createPageDouble();
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
    const requestAborts = Array.from({ length: 2 }, () => vi.fn().mockResolvedValue(undefined));
    const requestContinues = Array.from({ length: 2 }, () => vi.fn().mockResolvedValue(undefined));
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => false,
          url: () => "https://unresolved.example.net/challenge.js",
          headers: () => ({})
        }),
        abort: requestAborts[0]!,
        continue: requestContinues[0]!
      });
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => true,
          url: () => "https://unresolved.example.net/",
          headers: () => ({})
        }),
        abort: requestAborts[1]!,
        continue: requestContinues[1]!
      });
    });
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "unresolved.example.net") {
        throw new Error("ENOTFOUND");
      }
      return [{ address: "203.0.113.10", family: 4 }];
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
        route,
        close: closeContext
      }),
      close: closeBrowser
    });

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
        { debug: vi.fn(), warn: vi.fn() } as never,
        null,
        { targetPolicy: { allowInternalTargets: false, blockInternalTargets: true } }
      )
    ).rejects.toThrow("Blocked unresolved request target in sensitive mode");

    expect(
      mockLookup.mock.calls.filter(([hostname]) => hostname === "unresolved.example.net")
    ).toHaveLength(1);
    requestAborts.forEach((requestAbort) =>
      expect(requestAbort).toHaveBeenCalledWith("blockedbyclient")
    );
    requestContinues.forEach((requestContinue) => expect(requestContinue).not.toHaveBeenCalled());
  });

  it("relaunches to pin a public subresource discovered after navigation", async () => {
    const page = createPageDouble();
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
    const requestAbort = vi.fn().mockResolvedValue(undefined);
    const requestContinue = vi.fn().mockResolvedValue(undefined);
    page.goto.mockResolvedValue(undefined);
    page.waitForTimeout.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => false,
          url: () => "https://cdn.example.net/app.js",
          headers: () => ({})
        }),
        abort: requestAbort,
        continue: requestContinue
      });
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
      route,
      close: closeContext
    });
    mockLaunch.mockResolvedValue({ newContext, close: closeBrowser });

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
          hostResolverRules: "MAP example.com 203.0.113.10",
          targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
        }
      )
    ).resolves.toMatchObject({ resolvedUrl: "https://example.com/" });

    expect(requestAbort).toHaveBeenCalledWith("blockedbyclient");
    expect(requestContinue).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenNthCalledWith(2, {
      headless: true,
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10, MAP cdn.example.net 203.0.113.10"]
    });
  });

  it("coalesces concurrent requests to the same newly verified public IP", async () => {
    type RouteHandler = (route: {
      request: () => {
        isNavigationRequest: () => boolean;
        url: () => string;
        headers: () => Record<string, string>;
      };
      abort: (reason?: string) => Promise<void>;
      continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
    }) => Promise<void>;

    const page = createPageDouble();
    const requestAborts = [
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined)
    ];
    const requestContinues = [
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined)
    ];
    let routeHandler: RouteHandler | null = null;
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      const handler = routeHandler as RouteHandler;
      await Promise.all(
        ["app.js", "styles.css"].map((resource, index) =>
          handler({
            request: () => ({
              isNavigationRequest: () => false,
              url: () => `https://8.8.8.8/${resource}`,
              headers: () => ({})
            }),
            abort: requestAborts[index]!,
            continue: requestContinues[index]!
          })
        )
      );
    });

    mockLookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
        route: vi.fn().mockImplementation(async (_matcher, handler: RouteHandler) => {
          routeHandler = handler;
        }),
        close: closeContext
      }),
      close: closeBrowser
    });

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
      { debug: vi.fn(), warn: vi.fn() } as never,
      null,
      {
        hostResolverRules: "MAP example.com 203.0.113.10",
        targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
      }
    );

    expect(mockLookup.mock.calls.map((call) => call[0])).toEqual(["8.8.8.8"]);
    requestContinues.forEach((continueRequest) => expect(continueRequest).toHaveBeenCalledTimes(1));
    requestAborts.forEach((abort) => expect(abort).not.toHaveBeenCalled());
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith({
      headless: true,
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10"]
    });
    expect(closePage).not.toHaveBeenCalled();
    expect(closeContext).not.toHaveBeenCalled();
    expect(closeBrowser).not.toHaveBeenCalled();

    await result.page.close();
    await result.browser.close();
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("does not trust a stale resolver result in a browser launched without its pin", async () => {
    type RouteHandler = (route: {
      request: () => {
        isNavigationRequest: () => boolean;
        url: () => string;
        headers: () => Record<string, string>;
      };
      abort: (reason?: string) => Promise<void>;
      continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
    }) => Promise<void>;

    const closePages: ReturnType<typeof vi.fn>[] = [];
    const closeContexts: ReturnType<typeof vi.fn>[] = [];
    const closeBrowsers: ReturnType<typeof vi.fn>[] = [];
    const requestAborts: ReturnType<typeof vi.fn>[] = [];
    const requestContinues: ReturnType<typeof vi.fn>[] = [];
    let releaseLateLookup: (() => void) | null = null;
    let lateLookupCount = 0;
    let lateHandlerPromise: Promise<void> | null = null;
    let launchIndex = 0;

    mockLookup.mockImplementation((hostname: string) => {
      if (hostname === "late.example.net") {
        lateLookupCount += 1;
        if (lateLookupCount === 1) {
          return new Promise((resolve) => {
            releaseLateLookup = () => resolve([{ address: "203.0.113.30", family: 4 }] as never);
          });
        }
        return Promise.resolve([{ address: "203.0.113.30", family: 4 }]);
      }
      return Promise.resolve([{ address: "203.0.113.20", family: 4 }]);
    });

    mockLaunch.mockImplementation(async () => {
      const attemptIndex = launchIndex;
      launchIndex += 1;
      if (attemptIndex === 1) {
        if (!releaseLateLookup || !lateHandlerPromise) {
          throw new Error("stale resolver callback was not pending");
        }
        releaseLateLookup();
        await lateHandlerPromise;
      }

      const page = createPageDouble();
      let routeHandler: RouteHandler | null = null;
      const createRoute = (hostname: string) => {
        const abort = vi.fn().mockResolvedValue(undefined);
        const continueRequest = vi.fn().mockResolvedValue(undefined);
        requestAborts.push(abort);
        requestContinues.push(continueRequest);
        return {
          request: () => ({
            isNavigationRequest: () => false,
            url: () => `https://${hostname}/app.js`,
            headers: () => ({})
          }),
          abort,
          continue: continueRequest
        };
      };
      page.goto.mockImplementation(async () => {
        if (!routeHandler) {
          throw new Error("route handler not registered");
        }
        if (attemptIndex === 0) {
          lateHandlerPromise = routeHandler(createRoute("late.example.net"));
          await routeHandler(createRoute("fast.example.net"));
          return;
        }
        await routeHandler(createRoute("late.example.net"));
      });

      const closePage = vi.fn().mockResolvedValue(undefined);
      const closeContext = vi.fn().mockResolvedValue(undefined);
      const closeBrowser = vi.fn().mockResolvedValue(undefined);
      closePages.push(closePage);
      closeContexts.push(closeContext);
      closeBrowsers.push(closeBrowser);
      return {
        newContext: vi.fn().mockResolvedValue({
          addCookies: vi.fn().mockResolvedValue(undefined),
          newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
          route: vi.fn().mockImplementation(async (_matcher, handler: RouteHandler) => {
            routeHandler = handler;
          }),
          close: closeContext
        }),
        close: closeBrowser
      };
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
          hostResolverRules: "MAP example.com 203.0.113.10",
          targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
        }
      )
    ).resolves.toMatchObject({ resolvedUrl: "https://example.com/" });

    expect(mockLaunch).toHaveBeenCalledTimes(3);
    expect(mockLaunch.mock.calls[1]?.[0]?.args?.[0]).not.toContain("late.example.net");
    expect(mockLaunch.mock.calls[2]?.[0]?.args?.[0]).toContain("MAP late.example.net 203.0.113.30");
    expect(
      requestContinues.filter((continueRequest) => continueRequest.mock.calls.length)
    ).toHaveLength(1);
    expect(requestAborts.filter((abort) => abort.mock.calls.length)).toHaveLength(3);
    closePages.slice(0, 2).forEach((closePage) => expect(closePage).toHaveBeenCalledTimes(1));
    closeContexts
      .slice(0, 2)
      .forEach((closeContext) => expect(closeContext).toHaveBeenCalledTimes(1));
    closeBrowsers
      .slice(0, 2)
      .forEach((closeBrowser) => expect(closeBrowser).toHaveBeenCalledTimes(1));
  });

  it("caps hostile resolver relaunches and cleans every failed attempt", async () => {
    const closePages: ReturnType<typeof vi.fn>[] = [];
    const closeContexts: ReturnType<typeof vi.fn>[] = [];
    const closeBrowsers: ReturnType<typeof vi.fn>[] = [];
    let launchIndex = 0;

    mockLaunch.mockImplementation(async () => {
      const attemptIndex = launchIndex;
      launchIndex += 1;
      const page = createPageDouble();
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
      page.goto.mockImplementation(async () => {
        if (!routeHandler) {
          throw new Error("route handler not registered");
        }
        await routeHandler({
          request: () => ({
            isNavigationRequest: () => false,
            url: () => `https://cdn-${attemptIndex}.example.net/app.js`,
            headers: () => ({})
          }),
          abort: vi.fn().mockResolvedValue(undefined),
          continue: vi.fn().mockResolvedValue(undefined)
        });
      });

      const closePage = vi.fn().mockResolvedValue(undefined);
      const closeContext = vi.fn().mockResolvedValue(undefined);
      const closeBrowser = vi.fn().mockResolvedValue(undefined);
      closePages.push(closePage);
      closeContexts.push(closeContext);
      closeBrowsers.push(closeBrowser);

      return {
        newContext: vi.fn().mockResolvedValue({
          addCookies: vi.fn().mockResolvedValue(undefined),
          newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
          route: vi.fn().mockImplementation(async (_matcher, handler) => {
            routeHandler = handler;
          }),
          close: closeContext
        }),
        close: closeBrowser
      };
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
          hostResolverRules: "MAP example.com 203.0.113.10",
          targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
        }
      )
    ).rejects.toThrow(
      `Playwright resolver pinning relaunch budget exceeded while adding cdn-${MAX_RESOLVER_PINNING_RELAUNCHES}.example.net: ` +
        `${MAX_RESOLVER_PINNING_RELAUNCHES + 1} launches reached the ${MAX_RESOLVER_PINNING_RELAUNCHES + 1}-launch limit.`
    );

    expect(mockLaunch).toHaveBeenCalledTimes(MAX_RESOLVER_PINNING_RELAUNCHES + 1);
    for (const launchCall of mockLaunch.mock.calls) {
      const resolverArgument = launchCall[0]?.args?.find((arg: string) =>
        arg.startsWith("--host-resolver-rules=")
      );
      expect(resolverArgument).toBeDefined();
      expect(Buffer.byteLength(resolverArgument!, "utf8")).toBeLessThanOrEqual(
        MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES
      );
    }
    closePages.forEach((closePage) => expect(closePage).toHaveBeenCalledTimes(1));
    closeContexts.forEach((closeContext) => expect(closeContext).toHaveBeenCalledTimes(1));
    closeBrowsers.forEach((closeBrowser) => expect(closeBrowser).toHaveBeenCalledTimes(1));
  });

  it("caps distinct unresolved DNS discovery", async () => {
    const requestAborts: ReturnType<typeof vi.fn>[] = [];
    const requestHostnames = [
      ...Array.from(
        { length: MAX_RESOLVER_PINNING_HOSTS + 8 },
        (_, index) => `burst-${index}.example.net`
      ),
      ...Array.from({ length: MAX_RESOLVER_PINNING_HOSTS + 8 }, () => "burst-0.example.net")
    ];
    mockLookup.mockImplementation(async () => {
      throw new Error("ENOTFOUND");
    });
    const page = createPageDouble();
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
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await Promise.all(
        requestHostnames.map((hostname) => {
          const abort = vi.fn().mockResolvedValue(undefined);
          requestAborts.push(abort);
          return routeHandler!({
            request: () => ({
              isNavigationRequest: () => false,
              url: () => `https://${hostname}/app.js`,
              headers: () => ({})
            }),
            abort,
            continue: vi.fn().mockResolvedValue(undefined)
          });
        })
      );
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
        route: vi.fn().mockImplementation(async (_matcher, handler) => {
          routeHandler = handler;
        }),
        close: closeContext
      }),
      close: closeBrowser
    });

    const auditPromise = import("../src/runner/playwright.js").then(({ openPage }) =>
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
        { debug: vi.fn(), warn: vi.fn() } as never,
        null,
        {
          hostResolverRules: "MAP example.com 203.0.113.10",
          targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
        }
      )
    );

    const auditFailure = expect(auditPromise).rejects.toThrow(
      `Playwright resolver pinning hostname budget exceeded while adding burst-${MAX_RESOLVER_PINNING_HOSTS - 1}.example.net: ` +
        `${MAX_RESOLVER_PINNING_HOSTS + 1} hosts exceeds the ${MAX_RESOLVER_PINNING_HOSTS}-host limit.`
    );

    await vi.waitFor(() => {
      expect(mockLookup).toHaveBeenCalledTimes(MAX_RESOLVER_PINNING_HOSTS - 1);
    });
    await auditFailure;

    expect(mockLookup).toHaveBeenCalledTimes(MAX_RESOLVER_PINNING_HOSTS - 1);
    expect(requestAborts).toHaveLength(requestHostnames.length);
    requestAborts.forEach((abort) => expect(abort).toHaveBeenCalledWith("blockedbyclient"));
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("rejects resolver-rule growth before launching an oversized argument", async () => {
    const longHostname = `${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(50)}.net`;
    const rules: string[] = [];
    for (let index = 0; ; index += 1) {
      rules.push(`MAP seed-${index}.example.net 203.0.113.10`);
      const candidate = rules.join(", ");
      const withDiscoveredHost = `${candidate}, MAP ${longHostname} 203.0.113.10`;
      if (
        Buffer.byteLength(`--host-resolver-rules=${withDiscoveredHost}`, "utf8") >
        MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES
      ) {
        break;
      }
    }
    const initialRules = rules.join(", ");

    const page = createPageDouble();
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
    page.goto.mockImplementation(async () => {
      if (!routeHandler) {
        throw new Error("route handler not registered");
      }
      await routeHandler({
        request: () => ({
          isNavigationRequest: () => false,
          url: () => `https://${longHostname}/app.js`,
          headers: () => ({})
        }),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined)
      });
    });

    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({
      newContext: vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({ ...page, close: closePage }),
        route: vi.fn().mockImplementation(async (_matcher, handler) => {
          routeHandler = handler;
        }),
        close: closeContext
      }),
      close: closeBrowser
    });

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
        { debug: vi.fn(), warn: vi.fn() } as never,
        null,
        {
          hostResolverRules: initialRules,
          targetPolicy: { allowInternalTargets: false, blockInternalTargets: true }
        }
      )
    ).rejects.toThrow(
      `Playwright resolver pinning argument budget exceeded while adding ${longHostname}`
    );

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    const launchedArgument = mockLaunch.mock.calls[0]?.[0]?.args?.find((arg: string) =>
      arg.startsWith("--host-resolver-rules=")
    );
    expect(launchedArgument).toBeDefined();
    expect(Buffer.byteLength(launchedArgument!, "utf8")).toBeLessThanOrEqual(
      MAX_HOST_RESOLVER_RULE_ARGUMENT_BYTES
    );
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("does not re-resolve a previously trusted host during same-host navigations", async () => {
    const page = createPageDouble();
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
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10, MAP www.example.com 203.0.113.11"]
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
    const redirectedHandler = routeHandlerTwo as unknown as (route: {
      request: () => {
        isNavigationRequest: () => boolean;
        url: () => string;
        headers: () => Record<string, string>;
      };
      abort: (reason?: string) => Promise<void>;
      continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
    }) => Promise<void>;
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
      args: ["--host-resolver-rules=MAP example.com 203.0.113.10, MAP www.example.com 203.0.113.11"]
    });
    expect(mockLaunch).toHaveBeenNthCalledWith(3, {
      headless: true,
      args: [
        "--host-resolver-rules=MAP example.com 203.0.113.10, MAP www.example.com 203.0.113.11, MAP app.example.com 203.0.113.12"
      ]
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

  it("retains resolver pins when redirects revisit a previously verified host", async () => {
    const finalUrls = [
      "https://www.example.com/",
      "https://app.example.com/",
      "https://www.example.com/"
    ];
    const closePages = finalUrls.map(() => vi.fn().mockResolvedValue(undefined));
    const closeContexts = finalUrls.map(() => vi.fn().mockResolvedValue(undefined));
    const closeBrowsers = finalUrls.map(() => vi.fn().mockResolvedValue(undefined));

    finalUrls.forEach((finalUrl, index) => {
      const page = createPageDouble();
      page.url.mockReturnValue(finalUrl);
      const newContext = vi.fn().mockResolvedValue({
        addCookies: vi.fn().mockResolvedValue(undefined),
        newPage: vi.fn().mockResolvedValue({
          ...page,
          close: closePages[index]
        }),
        route: vi.fn().mockResolvedValue(undefined),
        close: closeContexts[index]
      });
      mockLaunch.mockResolvedValueOnce({
        newContext,
        close: closeBrowsers[index]
      });
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

    expect(result.resolvedUrl).toBe("https://www.example.com/");
    expect(mockLaunch).toHaveBeenCalledTimes(3);
    expect(closePages[0]).toHaveBeenCalledTimes(1);
    expect(closePages[1]).toHaveBeenCalledTimes(1);
    expect(closePages[2]).not.toHaveBeenCalled();
    expect(closeContexts[0]).toHaveBeenCalledTimes(1);
    expect(closeContexts[1]).toHaveBeenCalledTimes(1);
    expect(closeContexts[2]).not.toHaveBeenCalled();
    expect(closeBrowsers[0]).toHaveBeenCalledTimes(1);
    expect(closeBrowsers[1]).toHaveBeenCalledTimes(1);
    expect(closeBrowsers[2]).not.toHaveBeenCalled();
  });
  it("cleans up browser resources when final page stabilization fails", async () => {
    const page = createPageDouble();
    page.addStyleTag.mockRejectedValue(new Error("stability failed"));
    const closePage = vi.fn().mockResolvedValue(undefined);
    const closeContext = vi.fn().mockResolvedValue(undefined);
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const newContext = vi.fn().mockResolvedValue({
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue({
        ...page,
        close: closePage
      }),
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
        logger as never
      )
    ).rejects.toThrow("stability failed");

    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeContext).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
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

  it("rejects a screenshot target when its final response is an HTTP error", async () => {
    const page = createPageDouble();
    page.goto.mockResolvedValue({
      status: () => 500,
      url: () => "https://example.com/status"
    });
    const logger = { debug: vi.fn() };
    const { captureScreenshots } = await import("../src/runner/playwright.js");

    await expect(
      captureScreenshots(
        page as never,
        "https://example.com",
        {
          retries: { count: 1, delayMs: 5 },
          screenshots: [{ name: "Status", path: "/status", fullPage: true }]
        } as never,
        path.resolve(process.cwd(), "artifacts/screenshots"),
        logger as never
      )
    ).rejects.toThrow("Browser navigation failed with HTTP 500 for https://example.com/status");

    expect(page.screenshot).not.toHaveBeenCalled();
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

  it("fails screenshot gallery captures when lazy-loaded requests are blocked", async () => {
    const page = createPageDouble();
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
      addCookies: vi.fn().mockResolvedValue(undefined),
      newPage: vi.fn().mockResolvedValue(page),
      route,
      close: vi.fn().mockResolvedValue(undefined)
    });
    mockLaunch.mockResolvedValue({
      newContext,
      close: vi.fn().mockResolvedValue(undefined)
    });

    let evaluateCount = 0;
    const abortBlockedRequest = vi.fn().mockResolvedValue(undefined);
    page.evaluate.mockImplementation(async () => {
      evaluateCount += 1;
      if (evaluateCount === 1) {
        return 3600;
      }
      if (evaluateCount === 2) {
        if (!routeHandler) {
          throw new Error("route handler not registered");
        }
        await routeHandler({
          request: () => ({
            isNavigationRequest: () => false,
            url: () => "http://127.0.0.1/lazy.png",
            headers: () => ({})
          }),
          abort: abortBlockedRequest,
          continue: vi.fn().mockResolvedValue(undefined)
        });
      }
      return undefined;
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { captureScreenshots, openPage } = await import("../src/runner/playwright.js");
    const opened = await openPage(
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
    );

    await expect(
      captureScreenshots(
        opened.page,
        "https://example.com",
        {
          retries: { count: 1, delayMs: 5 },
          screenshots: [{ name: "Landing", path: "/", fullPage: true }],
          screenshotGallery: {
            enabled: true,
            maxScreenshotsPerPath: 5
          }
        } as never,
        path.resolve(process.cwd(), "artifacts/screenshots"),
        logger as never
      )
    ).rejects.toThrow("Blocked internal request target");
    expect(abortBlockedRequest).toHaveBeenCalledWith("blockedbyclient");
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

  it.each([false, true])(
    "relaunches after late public discovery when callback rejects: %s",
    async (rejectCallback) => {
      const initialNavigation = createRoutedBrowser();
      const firstCallbackRun = createRoutedBrowser();
      const retriedCallbackRun = createRoutedBrowser();
      mockLaunch
        .mockResolvedValueOnce(initialNavigation.browser)
        .mockResolvedValueOnce(firstCallbackRun.browser)
        .mockResolvedValueOnce(retriedCallbackRun.browser);

      const logger = { debug: vi.fn(), warn: vi.fn() };
      const { runPlaywrightLifecycle } = await import("../src/runner/playwright.js");
      const abortLateRequest = vi.fn().mockResolvedValue(undefined);
      const continueLateRequest = vi.fn().mockResolvedValue(undefined);
      let callbackRuns = 0;

      const result = await runPlaywrightLifecycle(
        "https://example.com",
        auditConfig(),
        logger as never,
        null,
        { targetPolicy: strictTargetPolicy },
        async () => {
          callbackRuns += 1;
          if (callbackRuns === 1) {
            await firstCallbackRun.getRouteHandler()({
              request: () => ({
                isNavigationRequest: () => false,
                url: () => "https://cdn.example.net/challenge.js",
                headers: () => ({})
              }),
              abort: abortLateRequest,
              continue: continueLateRequest
            });
            if (rejectCallback) throw new Error("waitForSelector timed out");
            return "stale result";
          }
          return "completed after resolver relaunch";
        }
      );

      expect(result).toBe("completed after resolver relaunch");
      expect(callbackRuns).toBe(2);
      expect(abortLateRequest).toHaveBeenCalledWith("blockedbyclient");
      expect(continueLateRequest).not.toHaveBeenCalled();
      expect(mockLaunch).toHaveBeenCalledTimes(3);
      expect(mockLaunch).toHaveBeenNthCalledWith(3, {
        headless: true,
        args: [
          "--host-resolver-rules=MAP example.com 203.0.113.10, MAP cdn.example.net 203.0.113.10"
        ]
      });
      expect(firstCallbackRun.closeBrowser).toHaveBeenCalledTimes(1);
      expect(retriedCallbackRun.closeBrowser).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    "preserves late private navigation failure when callback rejects: %s",
    async (rejectCallback) => {
      const browser = createRoutedBrowser();
      mockLaunch.mockResolvedValue(browser.browser);
      const abortPrivateNavigation = vi.fn().mockResolvedValue(undefined);
      const continuePrivateNavigation = vi.fn().mockResolvedValue(undefined);
      const callback = vi.fn(async () => {
        await browser.getRouteHandler()({
          request: () => ({
            isNavigationRequest: () => true,
            url: () => "http://127.0.0.1/private",
            headers: () => ({})
          }),
          abort: abortPrivateNavigation,
          continue: continuePrivateNavigation
        });
        if (rejectCallback) throw new Error("waitForSelector timed out");
        return "callback result";
      });
      const { runPlaywrightLifecycle } = await import("../src/runner/playwright.js");

      await expect(
        runPlaywrightLifecycle(
          "https://example.com",
          auditConfig(),
          { debug: vi.fn(), warn: vi.fn() } as never,
          null,
          {
            targetPolicy: strictTargetPolicy,
            hostResolverRules: "MAP example.com 203.0.113.10"
          },
          callback
        )
      ).rejects.toThrow("Blocked internal navigation target");

      expect(callback).toHaveBeenCalledTimes(1);
      expect(abortPrivateNavigation).toHaveBeenCalledWith("blockedbyclient");
      expect(continuePrivateNavigation).not.toHaveBeenCalled();
      expect(mockLaunch).toHaveBeenCalledTimes(1);
      expect(browser.closeBrowser).toHaveBeenCalledTimes(1);
    }
  );

  it("does not retry after a late unresolved navigation is blocked", async () => {
    const browser = createRoutedBrowser();
    mockLaunch.mockResolvedValue(browser.browser);
    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "unresolved.example.net") {
        throw new Error("ENOTFOUND");
      }
      return [{ address: "203.0.113.10", family: 4 }];
    });
    const abortUnresolvedNavigation = vi.fn().mockResolvedValue(undefined);
    const continueUnresolvedNavigation = vi.fn().mockResolvedValue(undefined);
    const callback = vi.fn(async () => {
      await browser.getRouteHandler()({
        request: () => ({
          isNavigationRequest: () => true,
          url: () => "https://unresolved.example.net/redirect",
          headers: () => ({})
        }),
        abort: abortUnresolvedNavigation,
        continue: continueUnresolvedNavigation
      });
      return "callback result";
    });
    const { runPlaywrightLifecycle } = await import("../src/runner/playwright.js");

    await expect(
      runPlaywrightLifecycle(
        "https://example.com",
        auditConfig(),
        { debug: vi.fn(), warn: vi.fn() } as never,
        null,
        {
          targetPolicy: strictTargetPolicy,
          hostResolverRules: "MAP example.com 203.0.113.10"
        },
        callback
      )
    ).rejects.toThrow("Blocked unresolved navigation target");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(abortUnresolvedNavigation).toHaveBeenCalledWith("blockedbyclient");
    expect(continueUnresolvedNavigation).not.toHaveBeenCalled();
    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(browser.closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("shares the resolver relaunch cap across initial and late discovery", async () => {
    const browsers = Array.from({ length: 7 }, () => createRoutedBrowser());
    for (const browser of browsers) {
      mockLaunch.mockResolvedValueOnce(browser.browser);
    }

    const { runPlaywrightLifecycle } = await import("../src/runner/playwright.js");
    let callbackRuns = 0;

    await expect(
      runPlaywrightLifecycle(
        "https://example.com",
        auditConfig(),
        { debug: vi.fn(), warn: vi.fn() } as never,
        null,
        { targetPolicy: strictTargetPolicy },
        async () => {
          const hostIndex = callbackRuns;
          callbackRuns += 1;
          await browsers[hostIndex + 1]!.getRouteHandler()({
            request: () => ({
              isNavigationRequest: () => false,
              url: () => `https://late-${hostIndex}.example.net/asset.js`,
              headers: () => ({})
            }),
            abort: vi.fn().mockResolvedValue(undefined),
            continue: vi.fn().mockResolvedValue(undefined)
          });
          return "stale result";
        }
      )
    ).rejects.toThrow(
      "Playwright resolver pinning relaunch budget exceeded while adding late-5.example.net"
    );

    expect(callbackRuns).toBe(6);
    expect(mockLaunch).toHaveBeenCalledTimes(MAX_RESOLVER_PINNING_RELAUNCHES + 1);
  });
});
