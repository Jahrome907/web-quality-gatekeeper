import { describe, expect, it } from "vitest";
import {
  sanitizeName,
  resolveUrl,
  validateScreenshotPath
} from "../src/runner/playwright.js";

describe("sanitizeName", () => {
  it("lowercases and strips special chars", () => {
    expect(sanitizeName("Home Page")).toBe("home-page");
  });

  it("preserves valid chars", () => {
    expect(sanitizeName("about-us")).toBe("about-us");
  });

  it("replaces multiple special chars", () => {
    expect(sanitizeName("Page #1 (Main)")).toBe("page--1--main-");
  });

  it("handles uppercase", () => {
    expect(sanitizeName("CONTACT")).toBe("contact");
  });

  it("preserves underscores and hyphens", () => {
    expect(sanitizeName("my_page-2")).toBe("my_page-2");
  });
});

describe("validateScreenshotPath", () => {
  it("accepts valid path starting with /", () => {
    expect(() => validateScreenshotPath("/about")).not.toThrow();
  });

  it("rejects URL injection", () => {
    expect(() => validateScreenshotPath("http://evil.com")).toThrow(
      "must be a relative path, not a URL"
    );
  });

  it("rejects https URL injection", () => {
    expect(() => validateScreenshotPath("https://evil.com/path")).toThrow(
      "must be a relative path, not a URL"
    );
  });

  it("rejects path without leading /", () => {
    expect(() => validateScreenshotPath("about")).toThrow("must start with /");
  });
});

describe("resolveUrl", () => {
  it("resolves relative path against base URL", () => {
    const result = resolveUrl("https://example.com", "/about");
    expect(result).toBe("https://example.com/about");
  });

  it("resolves root path", () => {
    const result = resolveUrl("https://example.com", "/");
    expect(result).toBe("https://example.com/");
  });

  it("resolves nested path", () => {
    const result = resolveUrl("https://example.com", "/docs/api");
    expect(result).toBe("https://example.com/docs/api");
  });
});
