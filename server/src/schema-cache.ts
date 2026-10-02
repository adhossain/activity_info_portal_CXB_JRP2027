interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes

const caches = new Map<string, Map<string, CacheEntry>>();

function sessionCache(sessionId: string): Map<string, CacheEntry> {
  let c = caches.get(sessionId);
  if (!c) {
    c = new Map();
    caches.set(sessionId, c);
  }
  return c;
}

export function getCached(sessionId: string, key: string): unknown | undefined {
  const entry = sessionCache(sessionId).get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    sessionCache(sessionId).delete(key);
    return undefined;
  }
  return entry.data;
}

export function setCache(sessionId: string, key: string, data: unknown): void {
  sessionCache(sessionId).set(key, { data, expiresAt: Date.now() + TTL_MS });
}

export function clearSessionCache(sessionId: string): void {
  caches.delete(sessionId);
}
