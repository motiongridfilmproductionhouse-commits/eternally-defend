/**
 * In-memory investigation cache for aliases, reference images, and provider health.
 * TTL-based; refresh when stale or explicitly requested.
 */

const cache = new Map<string, { value: unknown; expiresAt: number }>();

export function getInvestigationCache<T>(key: string): T | null {
  const row = cache.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    cache.delete(key);
    return null;
  }
  return row.value as T;
}

export function setInvestigationCache<T>(
  key: string,
  value: T,
  ttlMs = 3_600_000,
): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function invalidateInvestigationCache(keyPrefix?: string): void {
  if (!keyPrefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(keyPrefix)) cache.delete(key);
  }
}

export function investigationCacheSize(): number {
  return cache.size;
}
