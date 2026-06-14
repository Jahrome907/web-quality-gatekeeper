import { describe, expect, it } from "vitest";
import { applyScopedAuthHeaders, parseAuditAuth, toCookieHeader } from "../src/utils/auth.js";

describe("parseAuditAuth", () => {
  it("parses repeated header and cookie options", () => {
    const auth = parseAuditAuth(
      ["X-WQG-Auth: Token token-123", "X-Test: demo"],
      ["wqg_session=abc123", "theme=dark"]
    );

    expect(auth).toEqual({
      headers: {
        "X-WQG-Auth": "Token token-123",
        "X-Test": "demo"
      },
      cookies: [
        { name: "wqg_session", value: "abc123" },
        { name: "theme", value: "dark" }
      ]
    });
  });

  it("parses env-backed JSON headers and cookies", () => {
    const auth = parseAuditAuth([], [], {
      WQG_AUTH_HEADERS: '{"X-WQG-Auth":"Token env-token","X-Trace":"trace-1"}',
      WQG_AUTH_COOKIES: '{"wqg_session":"env-cookie"}'
    });

    expect(auth).toEqual({
      headers: {
        "X-WQG-Auth": "Token env-token",
        "X-Trace": "trace-1"
      },
      cookies: [{ name: "wqg_session", value: "env-cookie" }]
    });
  });

  it("lets explicit CLI headers override environment-provided values", () => {
    const auth = parseAuditAuth(["X-WQG-Auth: Token cli-token"], [], {
      WQG_AUTH_HEADERS: '{"x-wqg-auth":"Token env-token","X-Trace":"trace-1"}'
    });

    expect(auth).toEqual({
      headers: {
        "X-WQG-Auth": "Token cli-token",
        "X-Trace": "trace-1"
      },
      cookies: []
    });
  });

  it("returns null when no auth inputs are provided", () => {
    expect(parseAuditAuth([], [], {})).toBeNull();
  });

  it("throws for malformed header", () => {
    expect(() => parseAuditAuth(["X-WQG-Auth token"], [], {})).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "X-WQG-Auth: Token <token>".'
    );
  });

  it("rejects unsafe header names and values before browser routing", () => {
    expect(() => parseAuditAuth(["Bad Header: secret"], [], {})).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "X-WQG-Auth: Token <token>".'
    );
    expect(() => parseAuditAuth(["X-WQG-Auth: Token secret\r\nX-Evil: 1"], [], {})).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "X-WQG-Auth: Token <token>".'
    );
  });

  it("throws for malformed cookie", () => {
    expect(() => parseAuditAuth([], ["session"], {})).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "wqg_session=abc123".'
    );
  });

  it("rejects unsafe cookie names and values before browser routing", () => {
    expect(() => parseAuditAuth([], ["bad name=secret"], {})).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "wqg_session=abc123".'
    );
    expect(() => parseAuditAuth([], ["session=secret\r\nother=value"], {})).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "wqg_session=abc123".'
    );
  });

  it("rejects non-string auth JSON entries with deterministic errors", () => {
    expect(() => parseAuditAuth([], [], { WQG_AUTH_HEADERS: '{"X-WQG-Auth":42}' })).toThrow(
      'Invalid --header value. Expected "Name: Value", for example --header "X-WQG-Auth: Token <token>".'
    );
    expect(() => parseAuditAuth([], [], { WQG_AUTH_COOKIES: '["session=ok",42]' })).toThrow(
      'Invalid --cookie value. Expected "name=value", for example --cookie "wqg_session=abc123".'
    );
  });

  it("does not echo malformed auth secrets in parse errors", () => {
    const headerSecret = "Token secret-token-value";
    const cookieSecret = "wqg_session=secret-cookie-value";
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
        { name: "wqg_session", value: "abc123" },
        { name: "theme", value: "dark" }
      ])
    ).toBe("wqg_session=abc123; theme=dark");
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
      authHeaders: { "X-WQG-Auth": "Token secret", "X-Trace": "trace-1" }
    });

    expect(scoped["X-WQG-Auth"]).toBe("Token secret");
    expect(scoped["X-Trace"]).toBe("trace-1");
    expect(scoped.accept).toBe("*/*");
  });

  it("removes auth headers for cross-origin requests", () => {
    const scoped = applyScopedAuthHeaders({
      requestUrl: "https://cdn.example.net/app.js",
      targetUrl: "https://example.com/",
      requestHeaders: {
        "x-wqg-auth": "Token secret",
        "x-trace": "trace-1",
        accept: "*/*"
      },
      authHeaders: { "X-WQG-Auth": "Token secret", "X-Trace": "trace-1" }
    });

    expect(scoped["x-wqg-auth"]).toBeUndefined();
    expect(scoped["x-trace"]).toBeUndefined();
    expect(scoped.accept).toBe("*/*");
  });
});
