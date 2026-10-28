import { describe, expect, it } from "vitest";
import { adaptMetadataTask, ANILIST_TASK_UNSUPPORTED } from "./task-adapter";
import { mediaIdentityKey, metadataSearchHref, anilistDetailsHref, parseMediaSource } from "./types";
import { translateTmdbMedia } from "./translator";
import { queueCandidateTracking } from "../workflow-runtime";

describe("metadata identity and task compatibility", () => {
  it("separates equal numeric ids from different providers", () => {
    expect(mediaIdentityKey({ source: "tmdb", tmdbId: 123 })).toBe("tmdb_123");
    expect(mediaIdentityKey({ source: "anilist", anilistId: 123 })).toBe("anilist_123");
  });

  it("refuses AniList sequel targets rather than silently assuming TMDB season 1", () => {
    expect(adaptMetadataTask({ source: "anilist", anilistId: 123 }, { mediaType: "anime", seasonNumber: 3 }))
      .toEqual({ supported: false, reason: ANILIST_TASK_UNSUPPORTED });
  });

  it("also blocks direct candidate submission on the server before queue access", async () => {
    expect(await queueCandidateTracking("anilist_123")).toEqual({ status: "unsupported", message: ANILIST_TASK_UNSUPPORTED });
  });

  it("retains TMDB task formats and requires an explicit season", () => {
    expect(adaptMetadataTask({ source: "tmdb", tmdbId: 123 }, { mediaType: "movie" }))
      .toMatchObject({ supported: true, candidateId: "tmdb_movie_123" });
    expect(adaptMetadataTask({ source: "tmdb", tmdbId: 123 }, { mediaType: "tv", seasonNumber: 3 }))
      .toMatchObject({ supported: true, candidateId: "tmdb_tv_123_s3" });
    expect(adaptMetadataTask({ source: "tmdb", tmdbId: 123 }, { mediaType: "tv" }).supported).toBe(false);
    expect(adaptMetadataTask({ source: "tmdb", tmdbId: -1 }, { mediaType: "movie" }).supported).toBe(false);
  });

  it("translates TMDB display fields without changing the original candidate", () => {
    const candidate = { tmdbId: 123, title: "Title", originalTitle: "Title", mediaType: "tv" as const, year: 2026, posterPath: "/a.jpg", overview: "Story" };
    const media = translateTmdbMedia(candidate);
    expect(media).toMatchObject({ source: "tmdb", tmdbId: 123, episodeCount: null, aliases: ["Title"], posterUrl: "https://image.tmdb.org/t/p/w342/a.jpg" });
    expect(candidate).not.toHaveProperty("source");
  });

  it("preserves provider, query and workspace in navigation", () => {
    const href = metadataSearchHref("/w/quark-1", "薬屋 & 三", "anilist");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/w/quark-1");
    expect(url.searchParams.get("q")).toBe("薬屋 & 三");
    expect(url.searchParams.get("source")).toBe("anilist");
    expect(anilistDetailsHref(123, "quark-1")).toBe("/anime/anilist/123?w=quark-1");
    expect(parseMediaSource("unknown")).toBe("tmdb");
  });
});
