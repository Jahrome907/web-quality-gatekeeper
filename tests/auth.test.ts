import { describe, expect, it } from "vitest";
import { applyScopedAuthHeaders, parseAuditAuth, toCookieHeader } from "../src/utils/auth.js";

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

  it("lets explicit CLI headers override environment-provided values", () => {
    const auth = parseAuditAuth(["Authorization: Bearer cli-token"], [], {
      WQG_AUTH_HEADERS: '{"authorization":"Bearer env-token","X-Trace":"trace-1"}'
    });

    expect(auth).toEqual({
      headers: {
        Authorization: "Bearer cli-token",
        "X-Trace": "trace-1"
      },
      cookies: []
    });
  });

  it("returns null when no auth inputs are provided", () => {
    expect(parseAuditAuth([], [], {})).toBeNull();
  });

  it("throws for malformed header", () => {
    expect(() => parseAuditAuth(["Authorization token"], [], {})).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "Authorization: Bearer <token>".'
    );
  });

  it("rejects unsafe header names and values before browser routing", () => {
    expect(() => parseAuditAuth(["Bad Header: secret"], [], {})).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "Authorization: Bearer <token>".'
    );
    expect(() => parseAuditAuth(["Authorization: Bearer secret\r\nX-Evil: 1"], [], {})).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "Authorization: Bearer <token>".'
    );
  });

  it("throws for malformed cookie", () => {
    expect(() => parseAuditAuth([], ["session"], {})).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "session_id=abc123".'
    );
  });

  it("rejects unsafe cookie names and values before browser routing", () => {
    expect(() => parseAuditAuth([], ["bad name=secret"], {})).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "session_id=abc123".'
    );
    expect(() => parseAuditAuth([], ["session=secret\r\nother=value"], {})).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "session_id=abc123".'
    );
  });

  it("rejects non-string auth JSON entries with deterministic errors", () => {
    expect(() => parseAuditAuth([], [], { WQG_AUTH_HEADERS: '{"Authorization":42}' })).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "Authorization: Bearer <token>".'
    );
    expect(() => parseAuditAuth([], [], { WQG_AUTH_COOKIES: '["session=ok",42]' })).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "session_id=abc123".'
    );
  });

  it("does not echo malformed auth secrets in parse errors", () => {
    const headerSecret = "Bearer secret-token-value";
    const cookieSecret = "session_id=secret-cookie-value";
    let headerError: unknown;
    let cookieError: unknown;

    try {
      parseAuditAuth([headerSecret], [], {});
    } catch (error) {
      headerError = error;
    }
    expect(headerError).toBeInstanceOf(Error);
    expect((headerError as Error).message).not.toContain(headerSecret);

    try {
      parseAuditAuth([], [cookieSecret.replace("=", "")], {});
    } catch (error) {
      cookieError = error;
    }
    expect(cookieError).toBeInstanceOf(Error);
    expect((cookieError as Error).message).not.toContain("secret-cookie-value");
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

describe("applyScopedAuthHeaders", () => {
  it("applies auth headers for same-origin requests", () => {
    const scoped = applyScopedAuthHeaders({
      requestUrl: "https://example.com/assets/app.js",
      targetUrl: "https://example.com/",
      requestHeaders: { accept: "*/*" },
      authHeaders: { Authorization: "Bearer secret", "X-Trace": "trace-1" }
    });

    expect(scoped.Authorization).toBe("Bearer secret");
    expect(scoped["X-Trace"]).toBe("trace-1");
    expect(scoped.accept).toBe("*/*");
  });

  it("removes auth headers for cross-origin requests", () => {
    const scoped = applyScopedAuthHeaders({
      requestUrl: "https://cdn.example.net/app.js",
      targetUrl: "https://example.com/",
      requestHeaders: {
        authorization: "Bearer secret",
        "x-trace": "trace-1",
        accept: "*/*"
      },
      authHeaders: { Authorization: "Bearer secret", "X-Trace": "trace-1" }
    });

    expect(scoped.authorization).toBeUndefined();
    expect(scoped["x-trace"]).toBeUndefined();
    expect(scoped.accept).toBe("*/*");
  });
});
