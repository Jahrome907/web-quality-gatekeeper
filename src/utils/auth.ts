export interface AuthCookie {
  name: string;
  value: string;
}

export interface AuditAuth {
  headers: Record<string, string>;
  cookies: AuthCookie[];
}

function findHeaderKeyInsensitive(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      return key;
    }
  }
  return null;
}

function isSameOrigin(requestUrl: string, targetUrl: string): boolean {
  try {
    return new URL(requestUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

const HEADER_FORMAT_HINT =
  'Expected "Name: Value", for example --header "Authorization: Bearer <token>". ' +
  "Repeat --header for multiple values or use WQG_AUTH_HEADERS.";

const COOKIE_FORMAT_HINT =
  'Expected "name=value", for example --cookie "session_id=abc123". ' +
  "Repeat --cookie for multiple values or use WQG_AUTH_COOKIES.";

function parseHeaderEntry(entry: string): [string, string] {
  const trimmed = entry.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --header value: ${entry}. ${HEADER_FORMAT_HINT}`);
  }

  const name = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error(`Invalid --header value: ${entry}. ${HEADER_FORMAT_HINT}`);
  }

  return [name, value];
}

function parseCookieEntry(entry: string): AuthCookie {
  const trimmed = entry.trim();
  const firstPair = trimmed.split(";")[0]?.trim() ?? "";
  const separator = firstPair.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --cookie value: ${entry}. ${COOKIE_FORMAT_HINT}`);
  }

  const name = firstPair.slice(0, separator).trim();
  const value = firstPair.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error(`Invalid --cookie value: ${entry}. ${COOKIE_FORMAT_HINT}`);
  }

  return { name, value };
}

function splitByLine(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitCookieEnv(raw: string): string[] {
  return raw
    .split(/[;\r\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseHeaderEnv(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, string>;
    return Object.entries(parsed).map(([name, value]) => `${name}: ${value}`);
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as string[];
    return parsed;
  }
  return splitByLine(trimmed);
}

function parseCookieEnv(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, string>;
    return Object.entries(parsed).map(([name, value]) => `${name}=${value}`);
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as string[];
    return parsed;
  }
  return splitCookieEnv(trimmed);
}

function collectHeaderInputs(
  cliHeaders: string[],
  env: NodeJS.ProcessEnv
): string[] {
  const values: string[] = [];
  if (env.WQG_AUTH_HEADER) {
    values.push(env.WQG_AUTH_HEADER);
  }
  if (env.WQG_AUTH_HEADERS) {
    values.push(...parseHeaderEnv(env.WQG_AUTH_HEADERS));
  }
  values.push(...cliHeaders);
  return values;
}

function collectCookieInputs(
  cliCookies: string[],
  env: NodeJS.ProcessEnv
): string[] {
  const values: string[] = [];
  if (env.WQG_AUTH_COOKIE) {
    values.push(env.WQG_AUTH_COOKIE);
  }
  if (env.WQG_AUTH_COOKIES) {
    values.push(...parseCookieEnv(env.WQG_AUTH_COOKIES));
  }
  values.push(...cliCookies);
  return values;
}

function parseHeaderEntries(entries: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of entries) {
    const [name, value] = parseHeaderEntry(entry);
    const existingKey = findHeaderKeyInsensitive(headers, name);
    if (existingKey && existingKey !== name) {
      delete headers[existingKey];
    }
    headers[name] = value;
  }
  return headers;
}

export function applyScopedAuthHeaders(params: {
  requestUrl: string;
  targetUrl: string;
  requestHeaders: Record<string, string>;
  authHeaders: Record<string, string> | null;
}): Record<string, string> {
  const { requestUrl, targetUrl, requestHeaders, authHeaders } = params;
  if (!authHeaders || Object.keys(authHeaders).length === 0) {
    return requestHeaders;
  }

  const scopedHeaders = { ...requestHeaders };
  const shouldAttachAuth = isSameOrigin(requestUrl, targetUrl);
  for (const [headerName, headerValue] of Object.entries(authHeaders)) {
    const existingKey = findHeaderKeyInsensitive(scopedHeaders, headerName);
    if (shouldAttachAuth) {
      scopedHeaders[existingKey ?? headerName] = headerValue;
    } else if (existingKey) {
      delete scopedHeaders[existingKey];
    }
  }

  return scopedHeaders;
}

export function toCookieHeader(cookies: AuthCookie[]): string | null {
  if (cookies.length === 0) {
    return null;
  }
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export function parseAuditAuth(
  cliHeaders: string[],
  cliCookies: string[],
  env: NodeJS.ProcessEnv = process.env
): AuditAuth | null {
  const headerEntries = collectHeaderInputs(cliHeaders, env);
  const cookieEntries = collectCookieInputs(cliCookies, env);

  const headers = parseHeaderEntries(headerEntries);
  const cookies = cookieEntries.map(parseCookieEntry);

  if (Object.keys(headers).length === 0 && cookies.length === 0) {
    return null;
  }

  return { headers, cookies };
}
