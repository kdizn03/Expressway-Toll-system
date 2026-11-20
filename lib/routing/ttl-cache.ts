/**
 * Small in-process TTL cache. Used only for short-lived performance caching of Google
 * responses (minutes to an hour), well inside Google Maps Platform caching limits.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 200) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }

  delete(key: string) { this.entries.delete(key); }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
  }
}
