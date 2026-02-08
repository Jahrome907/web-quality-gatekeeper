import { describe, expect, it } from "vitest";
import { validateUrl, isInternalHost } from "../src/utils/url.js";

describe("isInternalHost", () => {
  it("detects localhost", () => {
    expect(isInternalHost("localhost")).toBe(true);
    expect(isInternalHost("LOCALHOST")).toBe(true);
  });

  it("detects 127.x.x.x loopback", () => {
    expect(isInternalHost("127.0.0.1")).toBe(true);
    expect(isInternalHost("127.255.255.255")).toBe(true);
  });

  it("detects 10.x private range", () => {
    expect(isInternalHost("10.0.0.1")).toBe(true);
    expect(isInternalHost("10.255.255.255")).toBe(true);
  });

  it("detects 192.168.x private range", () => {
    expect(isInternalHost("192.168.0.1")).toBe(true);
    expect(isInternalHost("192.168.100.200")).toBe(true);
  });

  it("detects 172.16-31.x private range", () => {
    expect(isInternalHost("172.16.0.1")).toBe(true);
    expect(isInternalHost("172.31.255.255")).toBe(true);
  });

  it("rejects 172 addresses outside private range", () => {
    expect(isInternalHost("172.15.0.1")).toBe(false);
    expect(isInternalHost("172.32.0.1")).toBe(false);
  });

  it("detects link-local 169.254.x", () => {
    expect(isInternalHost("169.254.1.1")).toBe(true);
  });

  it("detects IPv6 localhost", () => {
    expect(isInternalHost("::1")).toBe(true);
    expect(isInternalHost("[::1]")).toBe(true);
  });

  it("detects 0.0.0.0", () => {
    expect(isInternalHost("0.0.0.0")).toBe(true);
  });

  it("allows public IPs", () => {
    expect(isInternalHost("8.8.8.8")).toBe(false);
    expect(isInternalHost("93.184.216.34")).toBe(false);
  });

  it("allows public hostnames", () => {
    expect(isInternalHost("example.com")).toBe(false);
    expect(isInternalHost("google.com")).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts valid http URL", () => {
    const result = validateUrl("http://example.com");
    expect(result.url).toBe("http://example.com/");
    expect(result.isInternal).toBe(false);
  });

  it("accepts valid https URL", () => {
    const result = validateUrl("https://example.com/page");
    expect(result.url).toBe("https://example.com/page");
    expect(result.isInternal).toBe(false);
  });

  it("flags internal host", () => {
    const result = validateUrl("http://localhost:3000");
    expect(result.isInternal).toBe(true);
  });

  it("rejects ftp protocol", () => {
    expect(() => validateUrl("ftp://example.com")).toThrow("Invalid URL");
  });

  it("rejects file protocol", () => {
    expect(() => validateUrl("file:///etc/passwd")).toThrow("Invalid URL");
  });

  it("rejects malformed URL", () => {
    expect(() => validateUrl("not-a-url")).toThrow("Invalid URL");
  });

  it("rejects empty string", () => {
    expect(() => validateUrl("")).toThrow("Invalid URL");
  });
});
