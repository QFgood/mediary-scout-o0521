import { describe, expect, it, vi } from "vitest";
import { getAnimeDiscovery } from "./discovery";
import { mapAniListMedia } from "./mapper";

const anime = mapAniListMedia({ id: 123, type: "ANIME", title: { native: "作品" } })!;
const fallback = () => [{ tmdbId: 123, title: "TMDB 作品", year: 2026, posterPath: "/a.jpg", mediaType: "tv" as const }];

describe("anime discovery isolation and fallback", () => {
  it("prefers fresh AniList data without requesting TMDB", async () => {
    const tmdb = vi.fn(async () => fallback());
    const trending = vi.fn(async () => ({ value: [anime], status: "hit" as const }));
    const result = await getAnimeDiscovery("season", { client: { trending }, fallback: tmdb });
    expect(result).toMatchObject({ source: "anilist", stale: false, fallback: false });
    expect(result.cards[0]).toHaveProperty("anilistId", 123);
    expect(result.cards[0]).not.toHaveProperty("tmdbId");
    expect(tmdb).not.toHaveBeenCalled();
    expect(trending).toHaveBeenCalledWith("season");
  });

  it("uses historical AniList data before a TMDB fallback", async () => {
    const tmdb = vi.fn(async () => fallback());
    const result = await getAnimeDiscovery("trending", {
      client: { trending: async () => ({ value: [anime], status: "stale" }) }, fallback: tmdb,
    });
    expect(result).toMatchObject({ source: "anilist", stale: true, fallback: false });
    expect(tmdb).not.toHaveBeenCalled();
  });

  it("falls back on an AniList outage without mislabelling TMDB ids", async () => {
    const result = await getAnimeDiscovery("trending", {
      client: { trending: async () => { throw new Error("offline"); } }, fallback: async () => fallback(),
    });
    expect(result).toMatchObject({ source: "tmdb", fallback: true });
    expect(result.cards[0]).toMatchObject({ source: "tmdb", tmdbId: 123, posterUrl: "https://image.tmdb.org/t/p/w342/a.jpg" });
    expect(result.cards[0]).not.toHaveProperty("anilistId");
  });

  it("degrades safely when both providers fail or AniList has no results", async () => {
    const result = await getAnimeDiscovery("upcoming", {
      client: { trending: async () => ({ value: [], status: "miss" }) },
      fallback: async () => { throw new Error("TMDB offline"); },
    });
    expect(result.cards).toEqual([]);
    expect(result.fallback).toBe(true);
  });
});
