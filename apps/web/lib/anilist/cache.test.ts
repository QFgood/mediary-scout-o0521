import { describe, expect, it, vi } from "vitest";
import { AniListCache } from "./cache";

describe("AniList cache", () => {
  it("deduplicates in-flight requests and isolates returned objects", async () => {
    const cache = new AniListCache();
    let finish!: (value: number[]) => void;
    const loader = vi.fn(() => new Promise<number[]>((resolve) => { finish = resolve; }));
    const first = cache.load("search:x", 1000, 0, loader);
    const second = cache.load("search:x", 1000, 0, loader);
    finish([1]);
    const [a, b] = await Promise.all([first, second]);
    a.value.push(2);
    expect(b.value).toEqual([1]);
    expect((await cache.load("search:x", 1000, 0, loader)).value).toEqual([1]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("serves stale feed data on errors only within the configured stale window", async () => {
    let now = 0;
    const cache = new AniListCache(() => now);
    await cache.load("feed", 10, 20, async () => [1]);
    now = 15;
    const fail = async () => { throw new Error("offline"); };
    expect(await cache.load("feed", 10, 20, fail)).toEqual({ value: [1], status: "stale" });
    now = 31;
    await expect(cache.load("feed", 10, 20, fail)).rejects.toThrow("offline");
  });

  it("does not cache failures, and evicts completed entries at the capacity limit", async () => {
    const cache = new AniListCache(Date.now, 1);
    await expect(cache.load("bad", 1000, 0, async () => { throw new Error("bad"); })).rejects.toThrow();
    expect(await cache.load("bad", 1000, 0, async () => "recovered")).toMatchObject({ status: "miss", value: "recovered" });
    await cache.load("new", 1000, 0, async () => "new");
    expect(await cache.load("bad", 1000, 0, async () => "again")).toMatchObject({ status: "miss", value: "again" });
  });

  it("bounds distinct concurrent requests", async () => {
    const cache = new AniListCache(Date.now, 1);
    let finish!: (value: number) => void;
    const first = cache.load("a", 1000, 0, () => new Promise<number>((resolve) => { finish = resolve; }));
    await expect(cache.load("b", 1000, 0, async () => 2)).rejects.toThrow("请求较多");
    finish(1);
    await first;
  });
});
