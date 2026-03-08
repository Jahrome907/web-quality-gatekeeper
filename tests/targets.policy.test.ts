import { describe, expect, it, vi } from "vitest";
import type { Config } from "../src/config/schema.js";
import { resolveTargets } from "../src/audit/orchestration.js";
import { UsageError } from "../src/utils/url.js";

function createConfig(url: string): Config {
  return {
    urls: [{ name: "local", url }]
  } as unknown as Config;
}

describe("target resolution security policy", () => {
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
    const logger = { warn: vi.fn() };

    await expect(
      resolveTargets(undefined, createConfig("https://example.invalid"), "artifacts", "baselines", logger, {
        allowInternalTargets: false,
        blockInternalTargets: true
      })
    ).rejects.toBeInstanceOf(UsageError);
  });

  it("allows unresolved hostnames in non-sensitive mode with warning", async () => {
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
});
