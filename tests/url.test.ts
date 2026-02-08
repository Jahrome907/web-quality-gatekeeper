import { describe, expect, it } from "vitest";
import { UsageError, validateUrl } from "../src/utils/url.js";

describe("validateUrl edge cases", () => {
  it("normalizes trailing slash", () => {
    expect(validateUrl("https://example.com").url).toBe("https://example.com/");
  });

  it("preserves query and hash", () => {
    expect(validateUrl("https://example.com/path?q=1#frag").url).toBe(
      "https://example.com/path?q=1#frag"
    );
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
  });

  it("rejects non-http schemes", () => {
    expect(() => validateUrl("ws://example.com/socket")).toThrow("Invalid URL");
    expect(() => validateUrl("data:text/plain,hello")).toThrow("Invalid URL");
  });
});
