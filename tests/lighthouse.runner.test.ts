import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn()
}));
const mockLighthouse = vi.fn();
const mockLaunch = vi.fn();
const mockRetry = vi.fn();
const mockWriteJson = vi.fn();
const mockLoadLighthousePuppeteer = vi.fn();

vi.mock("lighthouse", () => ({
  default: mockLighthouse
}));
vi.mock("chrome-launcher", () => ({
  launch: mockLaunch
}));
vi.mock("../src/runner/lighthousePuppeteer.js", () => ({
  loadLighthousePuppeteer: mockLoadLighthousePuppeteer
}));
vi.mock("../src/utils/retry.js", () => ({
  retry: mockRetry
}));
vi.mock("node:dns/promises", () => ({
  lookup: mockLookup
}));
vi.mock("../src/utils/fs.js", async () => {
  const actual = await vi.importActual("../src/utils/fs.js");
  return {
    ...actual,
    writeJson: mockWriteJson
  };
});

function createBaseConfig(overrides?: Partial<Record<string, unknown>>) {
  return {
    retries: { count: 2, delayMs: 50 },
    lighthouse: {
      budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
      formFactor: "desktop"
    },
    ...overrides
  };
}

function createPuppeteerHarness() {
  let requestHandler:
    | ((request: {
        isNavigationRequest: () => boolean;
        url: () => string;
        headers: () => Record<string, string>;
        continue: (overrides?: { headers?: Record<string, string> }) => Promise<void>;
        abort: (errorCode?: string) => Promise<void>;
      }) => Promise<void>)
    | null = null;
  const page = {
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event, handler) => {
      if (event === "request") {
        requestHandler = handler;
      }
    }),
    close: vi.fn().mockResolvedValue(undefined)
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    disconnect: vi.fn().mockResolvedValue(undefined)
  };

  return {
    page,
    browser,
    connect: vi.fn().mockResolvedValue(browser),
    getRequestHandler: () => requestHandler
  };
}

describe("lighthouse runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookup.mockResolvedValue([{ address: "203.0.113.10", family: 4 }]);
    mockRetry.mockImplementation(async (fn: () => unknown) => fn());
  });

  it("extracts metrics, category scores, extended metrics, and budget boundaries", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.934 },
          accessibility: { score: 0.871 },
          "best-practices": { score: 0.992 },
          seo: { score: 0.886 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 2500 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.1 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 200 },
          "first-contentful-paint": { id: "first-contentful-paint", numericValue: 1000.4 },
          "speed-index": { id: "speed-index", numericValue: 2200.6 },
          interactive: { id: "interactive", numericValue: 3000.2 },
          "server-response-time": { id: "server-response-time", numericValue: 110.1 }
        }
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    const summary = await runLighthouseAudit(
      "https://example.com",
      "/tmp/artifacts",
      createBaseConfig() as never,
      { debug: vi.fn() } as never
    );

    expect(summary.metrics).toEqual({
      performanceScore: 0.93,
      lcpMs: 2500,
      cls: 0.1,
      tbtMs: 200
    });
    expect(summary.budgetResults).toEqual({
      performance: true,
      lcp: true,
      cls: true,
      tbt: true
    });
    expect(summary.categoryScores).toEqual({
      performance: 0.93,
      accessibility: 0.87,
      bestPractices: 0.99,
      seo: 0.89
    });
    expect(summary.extendedMetrics).toEqual({
      fcpMs: 1000.4,
      speedIndexMs: 2200.6,
      ttiMs: 3000.2,
      ttfbMs: 110.1
    });
    expect(mockRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        maxRetries: 2,
        baseDelayMs: 50,
        logger: { debug: expect.any(Function) }
      })
    );
    expect(mockWriteJson).toHaveBeenCalledWith(
      path.join("/tmp/artifacts", "lighthouse.json"),
      expect.any(Object)
    );
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("parses and ranks opportunities, capping to top 10", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });

    const audits: Record<string, unknown> = {
      "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
      "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.03 },
      "total-blocking-time": { id: "total-blocking-time", numericValue: 120 }
    };

    for (let i = 0; i < 12; i += 1) {
      audits[`op-${i}`] = {
        id: `op-${i}`,
        title: `Opportunity ${i}`,
        score: 0.8,
        displayValue: `${1000 - i * 10} ms`,
        details: {
          overallSavingsMs: 1000 - i * 10,
          overallSavingsBytes: i * 100
        }
      };
    }

    audits["bytes-only"] = {
      id: "bytes-only",
      title: "Bytes only",
      score: 0.5,
      displayValue: "200 KiB",
      details: {
        overallSavingsBytes: 2_000_000
      }
    };

    audits["diagnostics"] = {
      id: "diagnostics",
      title: "Diagnostics",
      score: 0.5,
      displayValue: "n/a"
    };

    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.9 }
        },
        audits
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    const summary = await runLighthouseAudit(
      "https://example.com",
      "/tmp/artifacts",
      createBaseConfig() as never,
      { debug: vi.fn() } as never
    );

    expect(summary.opportunities).toHaveLength(10);
    expect(summary.opportunities?.[0]?.id).toBe("bytes-only");
    expect(summary.opportunities?.some((item) => item.id === "diagnostics")).toBe(false);
  });

  it("handles partial/malformed lighthouse payloads with safe defaults", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {},
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: Number.NaN },
          "cumulative-layout-shift": { id: "cumulative-layout-shift" },
          "total-blocking-time": { id: "total-blocking-time", numericValue: Number.POSITIVE_INFINITY },
          "first-contentful-paint": { id: "first-contentful-paint" },
          "speed-index": { id: "speed-index", numericValue: undefined },
          interactive: { id: "interactive", numericValue: undefined },
          "server-response-time": { id: "server-response-time", numericValue: undefined }
        }
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    const summary = await runLighthouseAudit(
      "https://example.com",
      "/tmp/artifacts",
      createBaseConfig() as never,
      { debug: vi.fn() } as never
    );

    expect(summary.metrics).toEqual({
      performanceScore: 0,
      lcpMs: 0,
      cls: 0,
      tbtMs: 0
    });
    expect(summary.categoryScores).toEqual({
      performance: 0,
      accessibility: 0,
      bestPractices: 0,
      seo: 0
    });
    expect(summary.extendedMetrics).toEqual({
      fcpMs: 0,
      speedIndexMs: 0,
      ttiMs: 0,
      ttfbMs: 0
    });
    expect(summary.opportunities).toEqual([]);
  });

  it("passes auth headers and does not override explicit Cookie header", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    const puppeteer = createPuppeteerHarness();
    mockLoadLighthousePuppeteer.mockResolvedValue({
      connect: puppeteer.connect
    });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.95 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1700 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.03 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 110 }
        }
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    await runLighthouseAudit(
      "https://example.com",
      "/tmp/artifacts",
      createBaseConfig() as never,
      { debug: vi.fn() } as never,
      {
        headers: {
          Authorization: "Bearer token-123",
          Cookie: "already=set"
        },
        cookies: [{ name: "session_id", value: "abc123" }]
      }
    );

    const requestHandler = puppeteer.getRequestHandler();
    if (!requestHandler) {
      throw new Error("request handler not registered");
    }
    const continueRequest = vi.fn().mockResolvedValue(undefined);
    await requestHandler({
      isNavigationRequest: () => true,
      url: () => "https://example.com/",
      headers: () => ({
        Accept: "text/html",
        Cookie: "already=set"
      }),
      continue: continueRequest,
      abort: vi.fn().mockResolvedValue(undefined)
    });

    expect(mockLighthouse).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        port: 9222
      }),
      expect.any(Object),
      puppeteer.page
    );
    expect(continueRequest).toHaveBeenCalledWith({
      headers: {
        Accept: "text/html",
        Authorization: "Bearer token-123",
        Cookie: "already=set"
      }
    });
  });

  it("applies mobile emulation config for mobile formFactor", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.91 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
        }
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    await runLighthouseAudit(
      "https://example.com",
      "/tmp/artifacts",
      createBaseConfig({
        lighthouse: {
          budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
          formFactor: "mobile"
        }
      }) as never,
      { debug: vi.fn() } as never
    );

    expect(mockLighthouse).toHaveBeenCalledWith(
      "https://example.com",
      expect.any(Object),
      expect.objectContaining({
        settings: expect.objectContaining({
          formFactor: "mobile",
          screenEmulation: {
            mobile: true,
            width: 412,
            height: 823,
            deviceScaleFactor: 2
          }
        })
      })
    );
  });

  it("adds no-sandbox chrome flags in CI", async () => {
    const previousCI = process.env.CI;
    const previousActions = process.env.GITHUB_ACTIONS;
    process.env.CI = "true";
    process.env.GITHUB_ACTIONS = "true";

    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.95 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
        }
      }
    });

    try {
      const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
      await runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        { debug: vi.fn() } as never
      );

      expect(mockLaunch).toHaveBeenCalledWith(
        expect.objectContaining({
          chromeFlags: expect.arrayContaining([
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--disable-setuid-sandbox"
          ])
        })
      );
    } finally {
      if (previousCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = previousCI;
      }
      if (previousActions === undefined) {
        delete process.env.GITHUB_ACTIONS;
      } else {
        process.env.GITHUB_ACTIONS = previousActions;
      }
    }
  });

  it("pins DNS resolution in Chrome flags when host resolver rules are provided", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.95 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
        }
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    await runLighthouseAudit(
      "https://example.com",
      "/tmp/artifacts",
      createBaseConfig() as never,
      { debug: vi.fn() } as never,
      null,
      {
        hostResolverRules: "MAP example.com 203.0.113.10"
      }
    );

    expect(mockLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        chromeFlags: expect.arrayContaining(["--host-resolver-rules=MAP example.com 203.0.113.10"])
      })
    );
  });

  it("blocks internal Lighthouse redirects before the request is continued in sensitive mode", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    const puppeteer = createPuppeteerHarness();
    mockLoadLighthousePuppeteer.mockResolvedValue({
      connect: puppeteer.connect
    });
    const requestContinue = vi.fn().mockResolvedValue(undefined);
    const requestAbort = vi.fn().mockResolvedValue(undefined);
    mockLighthouse.mockImplementation(async () => {
      const requestHandler = puppeteer.getRequestHandler();
      if (!requestHandler) {
        throw new Error("request handler not registered");
      }
      await requestHandler({
        isNavigationRequest: () => true,
        url: () => "http://127.0.0.1:4010/",
        headers: () => ({}),
        continue: requestContinue,
        abort: requestAbort
      });
      throw new Error("lighthouse navigation failed");
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");

    await expect(
      runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        logger as never,
        null,
        {
          targetPolicy: {
            allowInternalTargets: false,
            blockInternalTargets: true
          }
        }
      )
    ).rejects.toThrow("Blocked internal Lighthouse navigation target");

    expect(requestContinue).not.toHaveBeenCalled();
    expect(requestAbort).toHaveBeenCalledWith("blockedbyclient");
    expect(puppeteer.page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(puppeteer.page.close).toHaveBeenCalledTimes(1);
    expect(puppeteer.browser.disconnect).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("blocks internal Lighthouse subresource requests in sensitive mode", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    const puppeteer = createPuppeteerHarness();
    mockLoadLighthousePuppeteer.mockResolvedValue({
      connect: puppeteer.connect
    });
    const requestContinue = vi.fn().mockResolvedValue(undefined);
    const requestAbort = vi.fn().mockResolvedValue(undefined);
    mockLighthouse.mockImplementation(async () => {
      const requestHandler = puppeteer.getRequestHandler();
      if (!requestHandler) {
        throw new Error("request handler not registered");
      }
      await requestHandler({
        isNavigationRequest: () => false,
        url: () => "http://127.0.0.1:4010/private-script.js",
        headers: () => ({}),
        continue: requestContinue,
        abort: requestAbort
      });
      return {
        lhr: {
          categories: {
            performance: { score: 0.95 }
          },
          audits: {
            "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
            "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
            "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
          }
        }
      };
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");

    await expect(
      runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        logger as never,
        null,
        {
          targetPolicy: {
            allowInternalTargets: false,
            blockInternalTargets: true
          }
        }
      )
    ).rejects.toThrow("Blocked internal Lighthouse request target");

    expect(requestContinue).not.toHaveBeenCalled();
    expect(requestAbort).toHaveBeenCalledWith("blockedbyclient");
    expect(puppeteer.page.close).toHaveBeenCalledTimes(1);
    expect(puppeteer.browser.disconnect).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("does not re-resolve the final Lighthouse URL when it stays on the original host", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    const puppeteer = createPuppeteerHarness();
    mockLoadLighthousePuppeteer.mockResolvedValue({
      connect: puppeteer.connect
    });
    mockLighthouse.mockResolvedValue({
      lhr: {
        finalDisplayedUrl: "https://example.com/dashboard",
        categories: {
          performance: { score: 0.95 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
        }
      }
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");

    await expect(
      runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        logger as never,
        null,
        {
          hostResolverRules: "MAP example.com 203.0.113.10",
          targetPolicy: {
            allowInternalTargets: false,
            blockInternalTargets: true
          }
        }
      )
    ).resolves.toMatchObject({
      metrics: expect.any(Object)
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(puppeteer.page.setRequestInterception).toHaveBeenCalledWith(true);
    expect(puppeteer.page.close).toHaveBeenCalledTimes(1);
    expect(puppeteer.browser.disconnect).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("re-resolves newly discovered Lighthouse hosts on repeated requests in sensitive mode", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    const puppeteer = createPuppeteerHarness();
    mockLoadLighthousePuppeteer.mockResolvedValue({
      connect: puppeteer.connect
    });
    const requestContinue = vi.fn().mockResolvedValue(undefined);
    const requestAbort = vi.fn().mockResolvedValue(undefined);

    mockLookup.mockImplementation(async (hostname: string) => {
      if (hostname === "example.com") {
        return [{ address: "203.0.113.10", family: 4 }];
      }
      if (hostname === "cdn.example.net") {
        return [{ address: "203.0.113.20", family: 4 }];
      }
      return [{ address: "203.0.113.30", family: 4 }];
    });

    mockLighthouse.mockImplementation(async () => {
      const requestHandler = puppeteer.getRequestHandler();
      if (!requestHandler) {
        throw new Error("request handler not registered");
      }

      await requestHandler({
        isNavigationRequest: () => false,
        url: () => "https://cdn.example.net/app.js",
        headers: () => ({}),
        continue: requestContinue,
        abort: requestAbort
      });
      await requestHandler({
        isNavigationRequest: () => false,
        url: () => "https://cdn.example.net/app.js",
        headers: () => ({}),
        continue: requestContinue,
        abort: requestAbort
      });

      return {
        lhr: {
          categories: {
            performance: { score: 0.95 }
          },
          audits: {
            "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
            "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
            "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
          }
        }
      };
    });

    const logger = { debug: vi.fn(), warn: vi.fn() };
    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");

    await expect(
      runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        logger as never,
        null,
        {
          hostResolverRules: "MAP example.com 203.0.113.10",
          targetPolicy: {
            allowInternalTargets: false,
            blockInternalTargets: true
          }
        }
      )
    ).resolves.toMatchObject({
      metrics: expect.any(Object)
    });

    expect(requestContinue).toHaveBeenCalledTimes(2);
    expect(requestAbort).not.toHaveBeenCalled();
    expect(mockLookup).toHaveBeenCalledTimes(3);
    expect(mockLookup.mock.calls.map((call) => call[0])).toEqual([
      "example.com",
      "cdn.example.net",
      "cdn.example.net"
    ]);
  });

  it("uses a deterministic portable runtime on non-Windows hosts and cleans it up", async () => {
    const previousLocalAppData = process.env.LOCALAPPDATA;
    const previousTemp = process.env.TEMP;
    const previousTmp = process.env.TMP;
    delete process.env.LOCALAPPDATA;
    delete process.env.TEMP;
    delete process.env.TMP;

    const outDir = await mkdtemp(path.join(tmpdir(), "wqg-lh-runtime-"));
    await mkdir(outDir, { recursive: true });

    const kill = vi.fn().mockResolvedValue(undefined);
    let launchLocalAppData: string | undefined;
    let launchTemp: string | undefined;
    let launchTmp: string | undefined;
    let launchUserDataDir: string | undefined;
    mockLaunch.mockImplementation(async () => {
      launchLocalAppData = process.env.LOCALAPPDATA;
      launchTemp = process.env.TEMP;
      launchTmp = process.env.TMP;
      return { port: 9222, kill };
    });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.95 }
        },
        audits: {
          "largest-contentful-paint": { id: "largest-contentful-paint", numericValue: 1500 },
          "cumulative-layout-shift": { id: "cumulative-layout-shift", numericValue: 0.01 },
          "total-blocking-time": { id: "total-blocking-time", numericValue: 100 }
        }
      }
    });

    try {
      const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
      await runLighthouseAudit(
        "https://example.com",
        outDir,
        createBaseConfig() as never,
        { debug: vi.fn() } as never
      );

      if (process.platform === "win32") {
        expect(launchLocalAppData).toBeUndefined();
      } else {
        launchUserDataDir = mockLaunch.mock.calls[0]?.[0]?.userDataDir;
        expect(launchLocalAppData).toMatch(new RegExp(`^${outDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.lighthouse-runtime-[^/]+/localappdata$`));
        expect(launchTemp).toMatch(new RegExp(`^${outDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.lighthouse-runtime-[^/]+/temp$`));
        expect(launchTmp).toBe(launchTemp);
        expect(launchUserDataDir).toMatch(new RegExp(`^${outDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.lighthouse-runtime-[^/]+/profile$`));
        const entries = await readdir(outDir);
        expect(entries.some((entry) => entry.startsWith(".lighthouse-runtime-"))).toBe(false);
      }
    } finally {
      if (previousLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previousLocalAppData;
      }
      if (previousTemp === undefined) {
        delete process.env.TEMP;
      } else {
        process.env.TEMP = previousTemp;
      }
      if (previousTmp === undefined) {
        delete process.env.TMP;
      } else {
        process.env.TMP = previousTmp;
      }
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("throws when lighthouse returns no lhr and always kills chrome", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({});

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    await expect(
      runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        { debug: vi.fn() } as never
      )
    ).rejects.toThrow("Lighthouse did not return a result");

    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("always kills chrome when lighthouse invocation throws", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockRejectedValue(new Error("lighthouse crashed"));

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    await expect(
      runLighthouseAudit(
        "https://example.com",
        "/tmp/artifacts",
        createBaseConfig() as never,
        { debug: vi.fn() } as never
      )
    ).rejects.toThrow("lighthouse crashed");

    expect(kill).toHaveBeenCalledTimes(1);
  });
});
