import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLaunch = vi.fn();
const mockRetry = vi.fn();
const mockEnsureDir = vi.fn();

vi.mock("playwright", () => ({
  chromium: {
    launch: mockLaunch
  }
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
    mockRetry.mockImplementation(async (fn: () => unknown) => fn());
  });

  it("opens page with auth headers and cookies", async () => {
    const page = createPageDouble();
    const addCookies = vi.fn().mockResolvedValue(undefined);
    const newPage = vi.fn().mockResolvedValue(page);
    const newContext = vi.fn().mockResolvedValue({
      addCookies,
      newPage
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
        headers: { Authorization: "Bearer token-123" },
        cookies: [{ name: "session_id", value: "abc123" }]
      }
    );

    expect(newContext).toHaveBeenCalledWith(
      expect.objectContaining({
        extraHTTPHeaders: { Authorization: "Bearer token-123" }
      })
    );
    expect(addCookies).toHaveBeenCalledWith([
      {
        name: "session_id",
        value: "abc123",
        url: "https://example.com"
      }
    ]);
    expect(page.on).toHaveBeenCalledWith("console", expect.any(Function));
    expect(page.on).toHaveBeenCalledWith("request", expect.any(Function));
    expect(mockRetry).toHaveBeenCalledWith(expect.any(Function), {
      maxRetries: 2,
      baseDelayMs: 10,
      logger
    });
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
      fullPage: true
    });
    expect(page.waitForSelector).toHaveBeenCalledWith("#app", { timeout: 10000 });
    expect(page.waitForTimeout).toHaveBeenCalledWith(100);
    expect(page.addStyleTag).toHaveBeenCalledTimes(1);
    expect(page.emulateMedia).toHaveBeenCalledWith({ reducedMotion: "reduce" });
    expect(mockRetry).toHaveBeenCalledWith(expect.any(Function), {
      maxRetries: 2,
      baseDelayMs: 15,
      logger
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
      fullPage: true
    });
    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "landing--vp-01.png"),
      fullPage: false
    });
    expect(page.screenshot).toHaveBeenCalledWith({
      path: path.join(outDir, "landing--vp-04.png"),
      fullPage: false
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
