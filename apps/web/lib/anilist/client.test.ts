import { describe, expect, it, vi } from "vitest";
import { AniListClient, broadcastPeriod } from "./client";

const media = { id: 123, type: "ANIME", title: { native: "薬屋" }, isAdult: false, format: "TV" };
const page = () => Response.json({ data: { Page: { media: [media] } } });

describe("AniList public GraphQL client", () => {
  it("uses variables rather than interpolating search text and shares normalized queries", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => page());
    const client = new AniListClient({ fetcher });
    const result = await client.search('  Kusuriya   "3"  ');
    expect(result.value[0]).toMatchObject({ source: "anilist", anilistId: 123 });
    expect((await client.search('kusuriya "3"')).status).toBe("hit");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://graphql.anilist.co");
    const body = JSON.parse(String(init?.body));
    expect(body.variables).toEqual({ search: 'Kusuriya "3"' });
    expect(body.query).not.toContain('Kusuriya "3"');
    expect(body.query).toContain("isAdult: false");
    expect(init?.headers).not.toHaveProperty("Authorization");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("avoids blank searches and rejects oversized queries and invalid ids without network calls", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new AniListClient({ fetcher });
    expect((await client.search("   ")).value).toEqual([]);
    await expect(client.search("a".repeat(201))).rejects.toThrow("200");
    for (const id of [0, -1, 1.5, NaN, 2_147_483_648]) await expect(client.details(id)).rejects.toThrow("编号");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects partial GraphQL errors and invalid bodies instead of caching an empty result", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errors: [{ message: "rate limited" }], data: { Page: { media: [] } } }))
      .mockResolvedValueOnce(Response.json({ data: { Page: {} } }))
      .mockResolvedValueOnce(page());
    const client = new AniListClient({ fetcher });
    await expect(client.search("x")).rejects.toThrow("完整元数据");
    await expect(client.search("x")).rejects.toThrow("无效的列表");
    expect((await client.search("x")).value).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After across different queries and retries after the cooldown", async () => {
    let now = 0;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(page());
    const client = new AniListClient({ fetcher, now: () => now });
    await expect(client.search("x")).rejects.toThrow("频率");
    await expect(client.search("y")).rejects.toThrow("频率");
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 2001;
    expect((await client.search("y")).value).toHaveLength(1);
  });

  it("propagates network and HTTP failures, then permits a new request", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(page());
    const client = new AniListClient({ fetcher });
    await expect(client.search("x")).rejects.toThrow("network unavailable");
    await expect(client.search("x")).rejects.toThrow("503");
    expect((await client.search("x")).status).toBe("miss");
  });

  it("aborts an unresponsive fetch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const client = new AniListClient({ fetcher, timeoutMs: 10 });
    await expect(client.search("x")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("caches independent details and never requests a TMDB mapping", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { Media: media } }));
    const client = new AniListClient({ fetcher });
    expect((await client.details(123)).value).toMatchObject({ anilistId: 123 });
    expect((await client.details(123)).status).toBe("hit");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).variables).toEqual({ id: 123 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("treats a null detail as missing, but rejects malformed detail data", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { Media: null } }))
      .mockResolvedValueOnce(Response.json({ data: { Media: {} } }));
    const client = new AniListClient({ fetcher });
    expect((await client.details(123)).value).toBeNull();
    await expect(client.details(124)).rejects.toThrow("无效的作品详情");
  });

  it("uses broadcast seasons only as feed filters and handles year changes", async () => {
    expect(broadcastPeriod(new Date("2026-10-28Z"))).toEqual({ season: "FALL", seasonYear: 2026 });
    expect(broadcastPeriod(new Date("2027-01-01Z"))).toEqual({ season: "WINTER", seasonYear: 2027 });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => page());
    const client = new AniListClient({ fetcher, now: () => Date.parse("2026-10-28Z") });
    await client.trending("season");
    await client.trending("upcoming");
    await client.trending("trending");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).variables).toEqual({ season: "FALL", seasonYear: 2026 });
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body)).query).toContain("status: NOT_YET_RELEASED");
    expect(JSON.parse(String(fetcher.mock.calls[2]![1]?.body)).variables).toEqual({ since: 20250101 });
  });
});
