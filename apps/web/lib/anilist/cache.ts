/** Bounded process cache, like the existing desktop metadata cache. No schema migration. */
export class AniListCache {
  private readonly values = new Map<string, { value: unknown; freshUntil: number; staleUntil: number }>();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly now: () => number = Date.now, private readonly limit = 256) {}

  async load<T>(key: string, ttlMs: number, load: () => Promise<T>, staleMs = 0): Promise<T> {
    const entry = this.values.get(key);
    if (entry && entry.freshUntil > this.now()) return structuredClone(entry.value) as T;
    const inFlight = this.pending.get(key);
    if (inFlight) return structuredClone(await inFlight) as T;
    const request = (async () => {
      try {
        const value = await load();
        // Evict expired entries as well as bounding keys nobody reads again.
        for (const [oldKey, old] of this.values) if (old.staleUntil <= this.now()) this.values.delete(oldKey);
        this.values.delete(key);
        while (this.values.size >= this.limit) this.values.delete(this.values.keys().next().value!);
        this.values.set(key, { value: structuredClone(value), freshUntil: this.now() + ttlMs, staleUntil: this.now() + ttlMs + staleMs });
        return value;
      } catch (error) {
        if (entry && entry.staleUntil > this.now() && staleMs > 0) return entry.value as T;
        throw error; // Never cache provider failures.
      }
    })();
    this.pending.set(key, request);
    try { return structuredClone(await request); }
    finally { this.pending.delete(key); }
  }
}
