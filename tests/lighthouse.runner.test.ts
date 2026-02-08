import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLighthouse = vi.fn();
const mockLaunch = vi.fn();
const mockRetry = vi.fn();
const mockWriteJson = vi.fn();

vi.mock("lighthouse", () => ({
  default: mockLighthouse
}));
vi.mock("chrome-launcher", () => ({
  launch: mockLaunch
}));
vi.mock("../src/utils/retry.js", () => ({
  retry: mockRetry
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

describe("lighthouse runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(mockRetry).toHaveBeenCalledWith(expect.any(Function), {
      retries: 2,
      delayMs: 50,
      logger: { debug: expect.any(Function) }
    });
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

    expect(mockLighthouse).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        extraHeaders: {
          Authorization: "Bearer token-123",
          Cookie: "already=set"
        }
      }),
      expect.any(Object)
    );
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

      expect(mockLaunch).toHaveBeenCalledWith({
        chromeFlags: [
          "--headless",
          "--disable-gpu",
          "--no-sandbox",
          "--disable-setuid-sandbox"
        ]
      });
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
