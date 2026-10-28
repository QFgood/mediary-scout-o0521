import { describe, expect, it, vi } from "vitest";
import { createSqliteWorkflowRepository, createStubAcquisitionModel, FakeResourceProvider, FakeStorageExecutor, InMemoryWorkflowRepository, queueTrackingInitialization, runQueuedType2Workflow, type PreparedTrackingTarget } from "@media-track/workflow";
import { adaptAniListTask, parseAniListCandidateId, parseVerifiedMappings } from "./task-adapter";
import type { AniListMetadata } from "../anilist/mapper";
import { translateTmdbCandidate } from "./translator";

const media: AniListMetadata = {
  source: "anilist", anilistId: 999, title: "作品 第三季", originalTitle: "作品 第3期", aliases: ["Title 3rd Season"],
  mediaType: "anime", year: 2026, posterUrl: null, overview: "", episodeCount: 12, format: "TV",
};
const mapping = { anilistId: 999, tmdbId: 111, seasonNumber: 3, episodeCount: 12, evidenceUrl: "https://example.com/reviewed-episode-list" };
function target(): PreparedTrackingTarget {
  return {
    title: { id: "tmdb_tv_111", tmdbId: 111, type: "anime", title: "作品", originalTitle: "作品", year: 2020, aliases: [], originCountries: ["JP"] },
    season: { id: "tmdb_tv_111_s3", mediaTitleId: "tmdb_tv_111", seasonNumber: 3, status: "active", qualityPreference: "4K", storageDirectoryId: "", totalEpisodes: 12, latestAiredEpisode: 2, latestAiredSource: "metadata" },
    keyword: "作品",
  };
}

describe("reviewed whole-season AniList task adaptation", () => {
  it("never guesses a mapping even when AniList and TMDB numeric IDs could coincide", async () => {
    const prepareTarget = vi.fn(async () => target());
    expect(await adaptAniListTask({ media, mappings: [], prepareTarget })).toMatchObject({ supported: false, reason: expect.stringContaining("尚无经核验") });
    expect(prepareTarget).not.toHaveBeenCalled();
  });

  it("rejects unknown counts, movie targets and invalid/ambiguous mapping configuration", async () => {
    const prepareTarget = vi.fn(async () => target());
    for (const update of [{ episodeCount: null }, { episodeCount: 24 }, { format: "MOVIE", mediaType: "movie" as const }]) {
      expect(await adaptAniListTask({ media: { ...media, ...update }, mappings: [mapping], prepareTarget })).toMatchObject({ supported: false });
    }
    expect(prepareTarget).not.toHaveBeenCalled();
    for (const mappings of [[{ ...mapping, tmdbId: -1 }], [{ ...mapping, evidenceUrl: "http://example.com" }], [mapping, mapping], [mapping, { ...mapping, anilistId: 1000 }], [{ ...mapping, episodeStart: 49 }]]) {
      expect(() => parseVerifiedMappings(JSON.stringify(mappings))).toThrow();
    }
    expect(parseVerifiedMappings(undefined)).toEqual([]);
    expect(() => parseVerifiedMappings("not-json")).toThrow();
  });

  it("blocks the problem case: third season mapped to a 60-episode TMDB first season", async () => {
    const unsafe = target();
    unsafe.season = { ...unsafe.season, seasonNumber: 1, totalEpisodes: 60 };
    expect(await adaptAniListTask({ media, mappings: [mapping], prepareTarget: async () => unsafe })).toMatchObject({ supported: false });
  });

  it("checks canonical identity, exact season, anime origin and refreshed episode count", async () => {
    for (const modify of [
      (t: PreparedTrackingTarget) => { t.title.tmdbId = 999; },
      (t: PreparedTrackingTarget) => { t.season.seasonNumber = 1; },
      (t: PreparedTrackingTarget) => { t.season.totalEpisodes = 13; },
      (t: PreparedTrackingTarget) => { t.title.type = "tv"; },
      (t: PreparedTrackingTarget) => { t.title.originCountries = ["CN"]; },
    ]) {
      const t = target(); modify(t);
      expect(await adaptAniListTask({ media, mappings: [mapping], prepareTarget: async () => t })).toMatchObject({ supported: false });
    }
  });

  it("retains the original selection alongside a real TMDB identity, without contaminating series aliases", async () => {
    const result = await adaptAniListTask({ media, mappings: parseVerifiedMappings(JSON.stringify([mapping])), prepareTarget: async () => target() });
    expect(result.supported).toBe(true);
    if (!result.supported) throw new Error("expected supported");
    expect(result.target.title).toMatchObject({ tmdbId: 111, aliases: [], title: "作品" });
    expect(result.target.season.metadataOrigin).toMatchObject({ source: "anilist", anilistId: 999, title: media.title, aliases: media.aliases });
    expect(result.target.season.seasonNumber).toBe(3);
    expect(result.target.keyword).toBe("作品");
  });

  it("does not parse an AniList ID as a TMDB candidate or accept malformed/unsafe integers", () => {
    expect(parseAniListCandidateId("anilist_anime_999")).toBe(999);
    for (const value of ["tmdb_tv_999_s3", "anilist_anime_0", "anilist_anime_999_s1", "anilist_anime_999x", "anilist_anime_9007199254740992"]) expect(parseAniListCandidateId(value)).toBeNull();
  });
});

describe("existing queue/worker persistence with AniList provenance", () => {
  for (const engine of ["memory", "sqlite"] as const) {
    it(`${engine}: keeps drive isolation, episode scope and original selection through the original worker`, async () => {
      const repository = engine === "memory" ? new InMemoryWorkflowRepository() : createSqliteWorkflowRepository({ path: ":memory:" });
      try {
        const compatibility = await adaptAniListTask({ media, mappings: [mapping], prepareTarget: async () => target() });
        if (!compatibility.supported) throw new Error("expected supported");
        const input = { ...compatibility.target, repository, connectedStorageId: "drive-b", createWorkflowRunId: () => "run-anilist" };
        expect((await queueTrackingInitialization(input)).status).toBe("queued");
        expect((await queueTrackingInitialization(input)).status).toBe("already_running");
        const queued = await repository.getWorkflowRunSnapshot("run-anilist");
        expect(queued?.episodes.map((episode) => episode.episodeCode)).toEqual(Array.from({ length: 12 }, (_, i) => `S03E${String(i + 1).padStart(2, "0")}`));
        expect(queued?.connectedStorageId).toBe("drive-b");
        expect(queued?.title.tmdbId).toBe(111);
        const outcome = await runQueuedType2Workflow({
          repository, model: createStubAcquisitionModel(), resourceProvider: new FakeResourceProvider({ keywordResults: {} }),
          storage: new FakeStorageExecutor(), storageParentDirectoryId: "tv-root", animeStorageParentDirectoryId: "anime-root",
        });
        expect(outcome.status).toBe("ran");
        const finished = await repository.getWorkflowRunSnapshot("run-anilist");
        expect(finished?.season.metadataOrigin?.anilistId).toBe(999);
        expect(finished?.season.seasonNumber).toBe(3);
        expect(finished?.workflowRun.status).toBe("no_coverage");
        expect(finished?.connectedStorageId).toBe("drive-b");
      } finally {
        if ("close" in repository) repository.close();
      }
    });
  }

  it("translates TMDB display fields while retaining its original identity", () => {
    const translated = translateTmdbCandidate({ tmdbId: 999, mediaType: "tv", title: "作品", originalTitle: "Title", year: 2026, overview: "test", posterPath: "/poster.jpg" });
    expect(translated).toMatchObject({ source: "tmdb", tmdbId: 999, aliases: ["Title"], episodeCount: null, posterUrl: "https://image.tmdb.org/t/p/w342/poster.jpg" });
    expect(translated).not.toHaveProperty("anilistId");
  });
});
