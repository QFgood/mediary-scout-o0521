import { describe, expect, it, vi } from "vitest";
import { AniListCache } from "./cache";
import { AniListClient, currentAnimeSeason } from "./client";
import { mapAniListMedia, plainDescription } from "./mapper";
import { getAniListSearchView } from "./search";
import { mediaIdentityKey, metadataSearchHref, parseMediaSource } from "../metadata/types";

const rawMedia = {
  id: 123, type: "ANIME", isAdult: false, countryOfOrigin: "JP",
  title: { native: "薬屋のひとりごと 第3期", romaji: "Kusuriya no Hitorigoto 3rd Season", english: null },
  synonyms: ["药屋少女的呢喃 第三季", "薬屋のひとりごと 第3期"],
  description: "<b>Story</b><br>More &amp; more", coverImage: { large: "https://s4.anilist.co/file/poster.jpg" },
  startDate: { year: 2027 }, seasonYear: 2027, season: "FALL", episodes: 12,
  format: "TV", status: "NOT_YET_RELEASED", popularity: 100,
};
const pageResponse = () => Response.json({ data: { Page: { media: [rawMedia] } } });

describe("AniList deterministic metadata translation", () => {
  it("retains original identity/titles without manufacturing a TMDB ID or ordinal season", () => {
    const media = mapAniListMedia(rawMedia)!;
    expect(media).toMatchObject({ source: "anilist", anilistId: 123, year: 2027, episodeCount: 12, broadcastSeason: "FALL", overview: "Story\nMore & more" });
    expect(media.aliases).toEqual(["Kusuriya no Hitorigoto 3rd Season", "药屋少女的呢喃 第三季"]);
    expect(media).not.toHaveProperty("tmdbId");
    expect(media).not.toHaveProperty("seasonNumber");
    expect(mediaIdentityKey(media)).not.toBe(mediaIdentityKey({ source: "tmdb", tmdbId: 123 }));
  });

  it("keeps unknown year/count unknown and distinguishes anime films", () => {
    expect(mapAniListMedia({ ...rawMedia, episodes: null, startDate: null, seasonYear: null, format: "MOVIE" }))
      .toMatchObject({ episodeCount: null, year: null, mediaType: "movie" });
  });

  it("rejects invalid/adult/non-Japanese entries and unsafe poster schemes", () => {
    for (const update of [{ id: -1 }, { isAdult: true }, { countryOfOrigin: "CN" }, { title: { native: null, romaji: null, english: null }, synonyms: [] }]) {
      expect(mapAniListMedia({ ...rawMedia, ...update })).toBeNull();
    }
    expect(mapAniListMedia({ ...rawMedia, coverImage: { large: "javascript:alert(1)" } })?.posterUrl).toBeNull();
    expect(plainDescription('<img src=x onerror="bad()">&lt;script&gt;')).toBe("<script>");
  });
});

describe("AniList cache", () => {
  it("coalesces requests, isolates mutations and expires results", async () => {
    let now = 0;
    const cache = new AniListCache(() => now);
    const load = vi.fn(async () => [{ title: "original" }]);
    const [a, b] = await Promise.all([cache.load("search:x", 100, load), cache.load("search:x", 100, load)]);
    a[0]!.title = "mutated";
    expect(b[0]!.title).toBe("original");
    expect((await cache.load("search:x", 100, load))[0]!.title).toBe("original");
    expect(load).toHaveBeenCalledTimes(1);
    now = 101;
    await cache.load("search:x", 100, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("serves historical trending data only within the stale window and retries failures", async () => {
    let now = 0;
    const cache = new AniListCache(() => now);
    await cache.load("feed", 100, async () => [1], 200);
    const fail = vi.fn(async (): Promise<number[]> => { throw new Error("offline"); });
    now = 150;
    await expect(cache.load("feed", 100, fail, 200)).resolves.toEqual([1]);
    await expect(cache.load("search", 100, fail)).rejects.toThrow("offline");
    await expect(cache.load("search", 100, fail)).rejects.toThrow("offline");
    expect(fail).toHaveBeenCalledTimes(3);
    now = 301;
    await expect(cache.load("feed", 100, fail, 200)).rejects.toThrow("offline");
  });

  it("bounds distinct query keys", async () => {
    const cache = new AniListCache(() => 0, 2);
    const load = vi.fn(async () => 1);
    for (const key of ["a", "b", "c", "a"]) await cache.load(key, 100, load);
    expect(load).toHaveBeenCalledTimes(4);
  });
});

describe("AniList API", () => {
  it("uses GraphQL variables, timeouts, country/adult filtering and normalized search caching", async () => {
    const transport = vi.fn<typeof fetch>(async () => pageResponse());
    const client = new AniListClient({ fetch: transport });
    await Promise.all([client.search("  药屋少女的呢喃   第三季 "), client.search("药屋少女的呢喃 第三季")]);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://graphql.anilist.co");
    const body = JSON.parse(init!.body as string);
    expect(body.variables).toEqual({ search: "药屋少女的呢喃 第三季" });
    expect(body.query).toContain('countryOfOrigin: "JP"');
    expect(body.query).toContain("isAdult: false");
    expect(body.query).not.toContain("药屋少女");
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(init!.cache).toBe("no-store");
    await expect(client.search(" ")).resolves.toEqual([]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("handles GraphQL/HTTP/malformed responses without caching provider failures", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ errors: [{ message: "bad query" }], data: { Page: { media: [rawMedia] } } }))
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: { unexpected: [] } }))
      .mockResolvedValueOnce(pageResponse());
    const client = new AniListClient({ fetch: transport });
    for (let i = 0; i < 3; i++) await expect(client.search("same")).rejects.toThrow();
    expect(await client.search("same")).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("honors 429 cooldown then retries", async () => {
    let now = 0;
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "10" } }))
      .mockResolvedValueOnce(pageResponse());
    const client = new AniListClient({ fetch: transport, now: () => now });
    await expect(client.search("x")).rejects.toThrow("429");
    await expect(client.search("y")).rejects.toThrow("频率受限");
    expect(transport).toHaveBeenCalledTimes(1);
    now = 10_001;
    expect(await client.search("x")).toHaveLength(1);
  });

  it("enforces timeout with the signal passed to the transport", async () => {
    const transport = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    }));
    await expect(new AniListClient({ fetch: transport, timeoutMs: 10 }).search("x")).rejects.toThrow();
  });

  it("preserves exact poster selection and validates detail IDs", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: { Media: rawMedia } }));
    const client = new AniListClient({ fetch: transport });
    expect((await client.details(123))?.anilistId).toBe(123);
    await expect(client.details(-1)).rejects.toThrow("ID");
    await expect(client.details(124)).rejects.toThrow("无效");
    const search = vi.fn(async () => []);
    const details = vi.fn(async () => mapAniListMedia(rawMedia));
    expect((await getAniListSearchView("title", "123", { search, details })).candidates[0]?.anilistId).toBe(123);
    expect(search).not.toHaveBeenCalled();
    expect((await getAniListSearchView("title", "123oops", { search, details })).state).toBe("provider_error");
  });

  it("constructs independent seasonal/trending/upcoming feeds and refreshes after TTL", async () => {
    let now = Date.parse("2026-10-28T00:00:00Z");
    const transport = vi.fn<typeof fetch>(async () => pageResponse());
    const client = new AniListClient({ fetch: transport, now: () => now });
    for (const feed of ["season", "trending", "upcoming"] as const) await client.trending(feed);
    const bodies = transport.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies[0].variables).toEqual({ season: "FALL", seasonYear: 2026 });
    expect(bodies[1].query).toContain("sort: TRENDING_DESC");
    expect(bodies[2].query).toContain("status: NOT_YET_RELEASED");
    await client.trending("season");
    expect(transport).toHaveBeenCalledTimes(3);
    now += 13 * 60 * 60 * 1000;
    transport.mockRejectedValue(new Error("offline"));
    expect(await client.trending("season")).toHaveLength(1);
    expect(currentAnimeSeason(new Date("2027-01-01T00:00:00Z"))).toEqual({ season: "WINTER", seasonYear: 2027 });
  });

  it("fails an empty feed so discovery can fall back to TMDB", async () => {
    const client = new AniListClient({ fetch: async () => Response.json({ data: { Page: { media: [] } } }) });
    await expect(client.trending("trending")).rejects.toThrow("为空");
  });
});

describe("source and workspace navigation", () => {
  it("keeps source, workspace, escaped query and exact AniList selection", () => {
    const href = metadataSearchHref("/w/drive-b", "anilist", "a & b", 123);
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/w/drive-b");
    expect(Object.fromEntries(url.searchParams)).toEqual({ tab: "search", source: "anilist", q: "a & b", anilistId: "123" });
    expect(metadataSearchHref("/", "tmdb", "a", 123)).not.toContain("anilistId");
    expect(parseMediaSource("unknown")).toBe("tmdb");
  });
});
