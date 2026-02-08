import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../src/config/loadConfig.js";

describe("loadConfig", () => {
  it("loads a valid config file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-cfg-"));
    const cfgPath = path.join(dir, "config.json");
    await writeFile(
      cfgPath,
      JSON.stringify({
        timeouts: { navigationMs: 30000, actionMs: 10000, waitAfterLoadMs: 1000 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "test/1.0",
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
      })
    );

    try {
      const config = await loadConfig(cfgPath);
      expect(config.timeouts.navigationMs).toBe(30000);
      expect(config.playwright.viewport.width).toBe(1280);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on missing file with cause", async () => {
    try {
      await loadConfig("/tmp/nonexistent-wqg-config.json");
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("Unable to read config file");
      expect((error as Error).cause).toBeDefined();
    }
  });

  it("throws on invalid JSON with cause", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-cfg-"));
    const cfgPath = path.join(dir, "bad.json");
    await writeFile(cfgPath, "not json{{{");

    try {
      await loadConfig(cfgPath);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("Invalid JSON");
      expect((error as Error).cause).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("throws on Zod validation failure", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-cfg-"));
    const cfgPath = path.join(dir, "invalid.json");
    await writeFile(cfgPath, JSON.stringify({ timeouts: { navigationMs: "not a number" } }));

    try {
      await loadConfig(cfgPath);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("Invalid config");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects timeout exceeding security limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "wqg-cfg-"));
    const cfgPath = path.join(dir, "over.json");
    await writeFile(
      cfgPath,
      JSON.stringify({
        timeouts: { navigationMs: 999999, actionMs: 10000, waitAfterLoadMs: 1000 },
        playwright: {
          viewport: { width: 1280, height: 720 },
          userAgent: "test/1.0",
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
      })
    );

    try {
      await loadConfig(cfgPath);
      expect.fail("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("Invalid config");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
