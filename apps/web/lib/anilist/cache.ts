export type CacheResult<T> = { value: T; status: "hit" | "miss" | "stale" };

/** Bounded process cache: also works on desktop, without a second DB schema. */
export class AniListCache {
  private readonly entries = new Map<string, { value: unknown; freshUntil: number; staleUntil: number }>();
  private readonly pending = new Map<string, Promise<CacheResult<unknown>>>();

  constructor(private readonly now: () => number = Date.now, private readonly capacity = 256) {}

  async load<T>(key: string, ttlMs: number, staleMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const entry = this.entries.get(key);
    if (entry && entry.freshUntil > this.now()) {
      return { value: structuredClone(entry.value) as T, status: "hit" };
    }
    const inflight = this.pending.get(key);
    if (inflight) return structuredClone(await inflight) as CacheResult<T>;
    // Limit distinct in-flight queries too, not just completed cache entries.
    if (this.pending.size >= this.capacity) {
      if (entry && entry.staleUntil > this.now()) {
        return { value: structuredClone(entry.value) as T, status: "stale" };
      }
      throw new Error("AniList 请求较多，请稍后重试。");
    }
    const request = (async (): Promise<CacheResult<T>> => {
      try {
        const value = await loader();
        this.entries.delete(key);
        while (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!);
        const freshUntil = this.now() + ttlMs;
        this.entries.set(key, { value: structuredClone(value), freshUntil, staleUntil: freshUntil + staleMs });
        return { value, status: "miss" };
      } catch (error) {
        if (entry && entry.staleUntil > this.now()) {
          return { value: structuredClone(entry.value) as T, status: "stale" };
        }
        throw error;
      }
    })();
    this.pending.set(key, request);
    try {
      return structuredClone(await request);
    } finally {
      this.pending.delete(key);
    }
  }
}
