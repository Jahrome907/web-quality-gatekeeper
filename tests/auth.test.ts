import { describe, expect, it } from "vitest";
import { parseAuditAuth, toCookieHeader } from "../src/utils/auth.js";

describe("parseAuditAuth", () => {
  it("parses repeated header and cookie options", () => {
    const auth = parseAuditAuth(
      ["Authorization: Bearer token-123", "X-Test: demo"],
      ["session_id=abc123", "theme=dark"]
    );

    expect(auth).toEqual({
      headers: {
        Authorization: "Bearer token-123",
        "X-Test": "demo"
      },
      cookies: [
        { name: "session_id", value: "abc123" },
        { name: "theme", value: "dark" }
      ]
    });
  });

  it("parses env-backed JSON headers and cookies", () => {
    const auth = parseAuditAuth([], [], {
      WQG_AUTH_HEADERS: '{"Authorization":"Bearer env-token","X-Trace":"trace-1"}',
      WQG_AUTH_COOKIES: '{"session_id":"env-cookie"}'
    });

    expect(auth).toEqual({
      headers: {
        Authorization: "Bearer env-token",
        "X-Trace": "trace-1"
      },
      cookies: [{ name: "session_id", value: "env-cookie" }]
    });
  });

  it("returns null when no auth inputs are provided", () => {
    expect(parseAuditAuth([], [], {})).toBeNull();
  });

  it("throws for malformed header", () => {
    expect(() => parseAuditAuth(["Authorization token"], [], {})).toThrow(
      'Invalid --header value: Authorization token. Expected "Name: Value".'
    );
  });

  it("throws for malformed cookie", () => {
    expect(() => parseAuditAuth([], ["session"], {})).toThrow(
      'Invalid --cookie value: session. Expected "name=value".'
    );
  });
});

describe("toCookieHeader", () => {
  it("builds an HTTP Cookie header", () => {
    expect(
      toCookieHeader([
        { name: "session_id", value: "abc123" },
        { name: "theme", value: "dark" }
      ])
    ).toBe("session_id=abc123; theme=dark");
  });

  it("returns null for empty cookies", () => {
    expect(toCookieHeader([])).toBeNull();
  });
});
