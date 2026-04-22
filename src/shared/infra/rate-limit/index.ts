// In-memory rate limiter — safe for single-process (current deployment).
// To support multi-instance, set REDIS_URL and swap the backend below.

type Entry = { count: number; resetAt: number };
const store = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  maxRequests = 10,
  windowMs = 60_000,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= maxRequests;
}
