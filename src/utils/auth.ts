export interface AuthCookie {
  name: string;
  value: string;
}

export interface AuditAuth {
  headers: Record<string, string>;
  cookies: AuthCookie[];
}

function parseHeaderEntry(entry: string): [string, string] {
  const trimmed = entry.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) {
    throw new Error(`Invalid --header value: ${entry}. Expected "Name: Value".`);
  }

  const name = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error(`Invalid --header value: ${entry}. Expected "Name: Value".`);
  }

  return [name, value];
}

function parseCookieEntry(entry: string): AuthCookie {
  const trimmed = entry.trim();
  const firstPair = trimmed.split(";")[0]?.trim() ?? "";
  const separator = firstPair.indexOf("=");
  if (separator <= 0) {
    throw new Error(`Invalid --cookie value: ${entry}. Expected "name=value".`);
  }

  const name = firstPair.slice(0, separator).trim();
  const value = firstPair.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error(`Invalid --cookie value: ${entry}. Expected "name=value".`);
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
  const values = [...cliHeaders];
  if (env.WQG_AUTH_HEADER) {
    values.push(env.WQG_AUTH_HEADER);
  }
  if (env.WQG_AUTH_HEADERS) {
    values.push(...parseHeaderEnv(env.WQG_AUTH_HEADERS));
  }
  return values;
}

function collectCookieInputs(
  cliCookies: string[],
  env: NodeJS.ProcessEnv
): string[] {
  const values = [...cliCookies];
  if (env.WQG_AUTH_COOKIE) {
    values.push(env.WQG_AUTH_COOKIE);
  }
  if (env.WQG_AUTH_COOKIES) {
    values.push(...parseCookieEnv(env.WQG_AUTH_COOKIES));
  }
  return values;
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

  const headers = Object.fromEntries(headerEntries.map(parseHeaderEntry));
  const cookies = cookieEntries.map(parseCookieEntry);

  if (Object.keys(headers).length === 0 && cookies.length === 0) {
    return null;
  }

  return { headers, cookies };
}
