import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/schema.js";
import { resolveTargets } from "../src/audit/orchestration.js";
import { NavigationTargetVerifier, UsageError } from "../src/utils/url.js";

const { mockLookup } = vi.hoisted(() => ({
  mockLookup: vi.fn()
}));

vi.mock("node:dns/promises", () => ({
  lookup: mockLookup
}));

function createConfig(url: string): Config {
  return {
    urls: [{ name: "local", url }]
  } as unknown as Config;
}

describe("target resolution security policy", () => {
  beforeEach(() => {
    mockLookup.mockReset();
  });

  it("pins resolved hostnames to the audited address in sensitive mode", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "203.0.113.10", family: 4 }]);
    const logger = { warn: vi.fn() };

    const targets = await resolveTargets(
      undefined,
      createConfig("https://example.com"),
      "artifacts",
      "baselines",
      logger,
      {
        allowInternalTargets: false,
        blockInternalTargets: true
      }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.url).toBe("https://example.com/");
    expect(targets[0]?.hostResolverRules).toBe("MAP example.com 203.0.113.10");
  });

  it("blocks internal targets in sensitive mode by default", async () => {
    const logger = { warn: vi.fn() };

    await expect(
      resolveTargets(undefined, createConfig("http://127.0.0.1:4173"), "artifacts", "baselines", logger, {
        allowInternalTargets: false,
        blockInternalTargets: true
      })
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("allows internal targets when explicit override is enabled", async () => {
    const logger = { warn: vi.fn() };

    const targets = await resolveTargets(
      undefined,
      createConfig("http://127.0.0.1:4173"),
      "artifacts",
      "baselines",
      logger,
      {
        allowInternalTargets: true,
        blockInternalTargets: true
      }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.url).toBe("http://127.0.0.1:4173/");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("warns but does not block internal targets in non-sensitive mode", async () => {
    const logger = { warn: vi.fn() };

    const targets = await resolveTargets(
      undefined,
      createConfig("http://127.0.0.1:4173"),
      "artifacts",
      "baselines",
      logger,
      {
        allowInternalTargets: false,
        blockInternalTargets: false
      }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.url).toBe("http://127.0.0.1:4173/");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("blocks unresolved hostnames in sensitive mode unless override is enabled", async () => {
    mockLookup.mockRejectedValueOnce(new Error("unresolved"));
    const logger = { warn: vi.fn() };

    await expect(
      resolveTargets(undefined, createConfig("https://example.invalid"), "artifacts", "baselines", logger, {
        allowInternalTargets: false,
        blockInternalTargets: true
      })
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("allows unresolved hostnames in non-sensitive mode with warning", async () => {
    mockLookup.mockRejectedValueOnce(new Error("unresolved"));
    const logger = { warn: vi.fn() };

    const targets = await resolveTargets(
      undefined,
      createConfig("https://example.invalid"),
      "artifacts",
      "baselines",
      logger,
      {
        allowInternalTargets: false,
        blockInternalTargets: false
      }
    );

    expect(targets).toHaveLength(1);
    expect(targets[0]?.url).toBe("https://example.invalid/");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Could not resolve example.invalid during SSRF safety checks")
    );
  });

  it("reuses initially trusted host resolver rules without re-resolving DNS", async () => {
    const logger = { warn: vi.fn() };
    const verifier = new NavigationTargetVerifier(
      logger,
      {
        allowInternalTargets: false,
        blockInternalTargets: true
      },
      {
        initialTrustedHosts: [["example.com", "MAP example.com 203.0.113.10"]]
      }
    );

    await expect(verifier.verify("https://example.com/docs", "navigation target")).resolves.toEqual({
      url: "https://example.com/docs",
      hostResolverRules: "MAP example.com 203.0.113.10"
    });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("can promote resolved hosts to trusted targets for browser relaunch flows", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "203.0.113.10", family: 4 }]);
    const logger = { warn: vi.fn() };
    const verifier = new NavigationTargetVerifier(logger, {
      allowInternalTargets: false,
      blockInternalTargets: true
    });

    await expect(verifier.verify("https://example.com/", "navigation target")).resolves.toEqual({
      url: "https://example.com/",
      hostResolverRules: "MAP example.com 203.0.113.10"
    });
    await expect(verifier.verify("https://example.com/pricing", "request target")).resolves.toEqual({
      url: "https://example.com/pricing",
      hostResolverRules: "MAP example.com 203.0.113.10"
    });
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });

  it("can avoid promoting resolved hosts when the launched browser cannot use new resolver rules", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "203.0.113.10", family: 4 }])
      .mockResolvedValueOnce([{ address: "203.0.113.10", family: 4 }]);
    const logger = { warn: vi.fn() };
    const verifier = new NavigationTargetVerifier(
      logger,
      {
        allowInternalTargets: false,
        blockInternalTargets: true
      },
      {
        trustResolvedHosts: false
      }
    );

    await verifier.verify("https://example.com/", "Lighthouse target");
    await verifier.verify("https://example.com/pricing", "Lighthouse request target");

    expect(mockLookup).toHaveBeenCalledTimes(2);
  });
});
