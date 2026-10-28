import { describe, expect, it } from "vitest";
import { mapAniListMedia } from "./mapper";

const entry = {
  id: 123, type: "ANIME", isAdult: false,
  title: { native: "薬屋のひとりごと 第3期", romaji: "Kusuriya no Hitorigoto 3", english: null },
  synonyms: ["药屋少女的呢喃 第三季", "Kusuriya no Hitorigoto 3", null],
  format: "TV", status: "NOT_YET_RELEASED", episodes: null, season: "FALL", seasonYear: 2027,
  coverImage: { extraLarge: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/a.jpg" },
  description: "<b>Story</b><br>Tom &amp; friends", popularity: 100,
  relations: { edges: [
    { relationType: "PREQUEL", node: { id: 122, type: "ANIME", title: { native: "第二季" } } },
    { relationType: "ADAPTATION", node: { id: 55, type: "MANGA", title: { native: "原作" } } },
  ] },
};

describe("AniList metadata normalization", () => {
  it("preserves original identity, multilingual titles and unknown episode count", () => {
    const media = mapAniListMedia(entry)!;
    expect(media).toMatchObject({ source: "anilist", anilistId: 123, title: entry.title.native, year: 2027, episodeCount: null });
    expect(media).not.toHaveProperty("tmdbId");
    expect(media.aliases).toEqual([entry.title.native, entry.title.romaji, "药屋少女的呢喃 第三季"]);
    expect(media.overview).toBe("Story\nTom & friends");
    expect(media.relations).toEqual([{ anilistId: 122, title: "第二季", relation: "PREQUEL" }]);
  });

  it("does not invent a sequel number from a title or a FALL broadcast period", () => {
    const media = mapAniListMedia(entry)!;
    expect(media.broadcastSeason).toBe("FALL");
    expect(media).not.toHaveProperty("seasonNumber");
    expect(media).not.toHaveProperty("season");
  });

  it("falls back to startDate and alternate titles without inventing missing counts", () => {
    expect(mapAniListMedia({ ...entry, title: { romaji: "Title" }, seasonYear: null, startDate: { year: 2026 }, episodes: -1 }))
      .toMatchObject({ title: "Title", originalTitle: "Title", year: 2026, episodeCount: null });
  });

  it("rejects malformed, non-anime and adult entries", () => {
    for (const invalid of [null, {}, { ...entry, id: 0 }, { ...entry, id: 1.5 }, { ...entry, title: {} },
      { ...entry, type: "MANGA" }, { ...entry, isAdult: true }]) {
      expect(mapAniListMedia(invalid)).toBeNull();
    }
  });

  it("accepts movie format and validates provider image URLs", () => {
    expect(mapAniListMedia({ ...entry, format: "MOVIE" })?.mediaType).toBe("movie");
    for (const url of ["javascript:alert(1)", "http://s4.anilist.co/a.jpg", "https://attacker.example/a.jpg", "/a.jpg"]) {
      expect(mapAniListMedia({ ...entry, coverImage: { extraLarge: url } })?.posterUrl).toBeNull();
    }
  });
});
