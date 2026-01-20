export function nowIso(): string {
  return new Date().toISOString();
}

export function durationMs(start: number): number {
  return Date.now() - start;
}
