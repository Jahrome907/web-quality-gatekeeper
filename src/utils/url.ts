export class UsageError extends Error {
  exitCode = 2;
}

const INTERNAL_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^\[?::1\]?$/,
  /^0\.0\.0\.0$/
];

export function isInternalHost(hostname: string): boolean {
  return INTERNAL_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function validateUrl(raw: string): { url: string; isInternal: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError(`Invalid URL: ${raw}`);
  }

  if (!parsed.protocol.startsWith("http")) {
    throw new UsageError(`Invalid URL: ${raw}`);
  }

  const internal = isInternalHost(parsed.hostname);
  return { url: parsed.toString(), isInternal: internal };
}
