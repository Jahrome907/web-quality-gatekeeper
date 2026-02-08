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

describe("lighthouse runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRetry.mockImplementation(async (fn: () => unknown) => fn());
  });

  it("runs lighthouse with merged auth headers and cookie header", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockResolvedValue({
      lhr: {
        categories: {
          performance: { score: 0.93 }
        },
        audits: {
          "largest-contentful-paint": { numericValue: 1700 },
          "cumulative-layout-shift": { numericValue: 0.03 },
          "total-blocking-time": { numericValue: 110 }
        }
      }
    });

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    const summary = await runLighthouseAudit(
      "https://example.com",
      path.resolve(process.cwd(), "artifacts"),
      {
        lighthouse: {
          budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
          formFactor: "desktop"
        }
      } as never,
      { debug: vi.fn() } as never,
      {
        headers: { Authorization: "Bearer token-123" },
        cookies: [{ name: "session_id", value: "abc123" }]
      }
    );

    expect(mockLighthouse).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        port: 9222,
        extraHeaders: {
          Authorization: "Bearer token-123",
          Cookie: "session_id=abc123"
        }
      }),
      expect.any(Object)
    );
    expect(summary.budgetResults).toEqual({
      performance: true,
      lcp: true,
      cls: true,
      tbt: true
    });
    expect(mockWriteJson).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "artifacts", "lighthouse.json"),
      expect.any(Object)
    );
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it("always kills chrome when lighthouse throws", async () => {
    const kill = vi.fn().mockResolvedValue(undefined);
    mockLaunch.mockResolvedValue({ port: 9222, kill });
    mockLighthouse.mockRejectedValue(new Error("lighthouse crashed"));

    const { runLighthouseAudit } = await import("../src/runner/lighthouse.js");
    await expect(
      runLighthouseAudit(
        "https://example.com",
        path.resolve(process.cwd(), "artifacts"),
        {
          lighthouse: {
            budgets: { performance: 0.9, lcpMs: 2500, cls: 0.1, tbtMs: 200 },
            formFactor: "desktop"
          }
        } as never,
        { debug: vi.fn() } as never
      )
    ).rejects.toThrow("lighthouse crashed");

    expect(kill).toHaveBeenCalledTimes(1);
  });
});
