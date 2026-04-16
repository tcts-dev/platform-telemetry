/**
 * Copyright (c) 2026 CK Scrivner, Inc. All rights reserved.
 * Proprietary and confidential. Unauthorized use is prohibited.
 */

/**
 * Trivial in-memory TTL cache. One instance per process; not shared across
 * instances of the service. That's fine — the worst case is that a service
 * with N instances makes N budget-check calls to MC at cold start and then
 * stays quiet for the TTL period.
 */
interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<K, V> {
  private store = new Map<K, Entry<V>>();

  constructor(private defaultTtlMs: number) {}

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /** For tests: override the clock. */
  _setExpiry(key: K, expiresAt: number): void {
    const hit = this.store.get(key);
    if (hit) hit.expiresAt = expiresAt;
  }
}
