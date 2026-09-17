import { describe, expect, it } from "vitest";
import {
  UsageError,
  classifyTargetUrl,
  createUrlPrivacyTracker,
  isInternalIpAddress,
  sanitizeUrlForDisplay,
  sanitizeUrlsInText,
  validateUrl
} from "../src/utils/url.js";

describe("validateUrl edge cases", () => {
  it("normalizes trailing slash", () => {
    expect(validateUrl("https://example.com").url).toBe("https://example.com/");
  });

  it("preserves query and hash", () => {
    expect(validateUrl("https://example.com/path?q=1#frag").url).toBe(
      "https://example.com/path?q=1#frag"
    );
  });

  it("uses a redacted URL for tool-authored display", () => {
    expect(
      sanitizeUrlForDisplay("https://alice:secret@example.com/path?access_token=demo-value#callback")
    ).toBe("https://example.com/path");
  });

  it("redacts HTTP URLs embedded in diagnostics", () => {
    expect(
      sanitizeUrlsInText("Navigation failed for https://example.com/callback?code=demo-value#done")
    ).toBe("Navigation failed for https://example.com/callback");
  });

  it("tracks URL sensitivity for the whole run", () => {
    const tracker = createUrlPrivacyTracker();

    tracker.observeUrl("https://example.com/health");
    expect(tracker.sensitive).toBe(false);

    tracker.observeUrl("https://example.com/callback?code=demo-value");
    expect(tracker.sensitive).toBe(true);

    tracker.observeUrl("https://example.com/health");
    expect(tracker.sensitive).toBe(true);
  });

  it("keeps non-URL sensitivity separate from URL-sensitive display handling", () => {
    const tracker = createUrlPrivacyTracker(true);

    expect(tracker.sensitive).toBe(true);
    expect(tracker.urlSensitive).toBe(false);
  });

  it("flags private 172.16 address as internal", () => {
    const result = validateUrl("http://172.16.1.2:8080/path");
    expect(result.isInternal).toBe(true);
  });

  it("does not flag public hostname as internal", () => {
    const result = validateUrl("https://developer.mozilla.org");
    expect(result.isInternal).toBe(false);
  });

  it("flags loopback IPv4 as internal", () => {
    const result = validateUrl("http://127.0.0.1:3000/dashboard");
    expect(result.isInternal).toBe(true);
  });

  it("flags loopback IPv6 as internal", () => {
    const result = validateUrl("http://[::1]:8080/health");
    expect(result.isInternal).toBe(true);
  });

  it("flags 0.0.0.0 as internal", () => {
    const result = validateUrl("http://0.0.0.0:5173");
    expect(result.isInternal).toBe(true);
  });

  it("preserves explicit non-default port in normalized URL", () => {
    const result = validateUrl("https://example.com:8443/path");
    expect(result.url).toBe("https://example.com:8443/path");
  });

  it("throws UsageError for malformed URLs", () => {
    expect(() => validateUrl("http://")).toThrow(UsageError);
    expect(() => validateUrl("http://")).toThrow("Expected an absolute http:// or https:// URL");
  });

  it("rejects non-http schemes", () => {
    expect(() => validateUrl("ws://example.com/socket")).toThrow("Invalid URL");
    expect(() => validateUrl("data:text/plain,hello")).toThrow("Invalid URL");
    expect(() => validateUrl("httpx://example.com")).toThrow("Invalid URL");
    expect(() => validateUrl("httpsx://example.com")).toThrow("Invalid URL");
    expect(() => validateUrl("ws://example.com/socket")).toThrow(
      "Use http:// or https:// URLs only."
    );
  });

  it("rejects URLs that embed credentials", () => {
    expect(() => validateUrl("https://alice:secret@example.com")).toThrow(
      "Username/password in URLs are not allowed"
    );
    expect(() => validateUrl("https://alice:secret@example.com")).not.toThrow("secret");
  });

  it("redacts credentials from URL validation errors", () => {
    expect(() => validateUrl("ftp://alice:secret@example.com/file")).toThrow(
      "ftp://example.com/file"
    );
    expect(() => validateUrl("ftp://alice:secret@example.com/file")).not.toThrow("secret");
  });

  it("detects private IPv4 ranges in IP classifier", () => {
    expect(isInternalIpAddress("10.0.0.12")).toBe(true);
    expect(isInternalIpAddress("100.64.12.34")).toBe(true);
    expect(isInternalIpAddress("172.31.255.254")).toBe(true);
    expect(isInternalIpAddress("192.168.12.34")).toBe(true);
    expect(isInternalIpAddress("198.18.0.42")).toBe(true);
    expect(isInternalIpAddress("8.8.8.8")).toBe(false);
  });

  it("detects private IPv6 ranges in IP classifier", () => {
    expect(isInternalIpAddress("::1")).toBe(true);
    expect(isInternalIpAddress("fe80::1")).toBe(true);
    expect(isInternalIpAddress("fc00::abcd")).toBe(true);
    expect(isInternalIpAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("classifies literal internal targets without DNS lookups", async () => {
    const result = await classifyTargetUrl("http://127.0.0.1:8080");
    expect(result.isInternal).toBe(true);
    expect(result.reason).toBe("literal");
  });
});
