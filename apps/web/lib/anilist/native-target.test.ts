import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import {
  createSqliteWorkflowRepository, FakeResourceProvider, FakeStorageExecutor, InMemoryWorkflowRepository,
  queueTrackingInitialization, runQueuedType2Workflow, runScheduledType3Monitoring, createStubAcquisitionModel,
  mediaLibraryFolderName, type ResourceProvider,
} from "@media-track/workflow";
import { mediaHref, mediaKey, mediaPosterUrl } from "@media-track/workflow/scope";
import { prepareNativeAniListTarget } from "./native-target";
import { getAniListAcquisitionTarget } from "./task";
import type { AniListMetadata } from "./mapper";
import { getActivityView } from "../activity-view";
import { findActiveRun } from "../inline-progress";

const media: AniListMetadata = {
  source: "anilist", anilistId: 999, title: "凶乱令嬢ニア・リストン", originalTitle: "凶乱令嬢ニア・リストン",
  aliases: ["Nia Liston: The Merciless Maiden"], year: 2026, mediaType: "anime", format: "TV", status: "RELEASING",
  posterUrl: "https://s4.anilist.co/fixture.jpg", overview: "Test fixture", episodeCount: 25,
  nextAiringEpisode: { episode: 3, airingAt: 1_900_000_000 },
};
function target(value: AniListMetadata = media) {
  const result = prepareNativeAniListTarget(value);
  if (!result.supported) throw new Error(result.reason);
  return result.target;
}

afterEach(() => vi.unstubAllEnvs());

describe("native AniList acquisition without a TMDB mapping", () => {
  it("enables the reported 25-episode TV entry without TMDB or mapping configuration", async () => {
    vi.stubEnv("MEDIA_TRACK_ANILIST_MAPPINGS", "");
    vi.stubEnv("MEDIA_TRACK_SEARCH_PROVIDER", "demo");
    const result = await getAniListAcquisitionTarget(media);
    expect(result).toMatchObject({ supported: true, mode: "native", target: {
      title: { source: "anilist", anilistId: 999, tmdbId: null, id: "anilist_anime_999", title: media.title },
      season: { totalEpisodes: 25, latestAiredEpisode: 2, id: "anilist_anime_999_s1" },
    } });
  });

  it("keeps sequel names and entry numbering rather than guessing a TMDB season", () => {
    const native = target({ ...media, title: "作品 第三季", aliases: ["Series 3rd Season"] });
    expect(native.keyword).toBe("作品 第三季");
    expect(native.title.episodeNumbering).toBe("entry_relative");
    expect(native.title.tmdbId).toBeNull();
    expect(native.season.metadataOrigin).toBeUndefined();
  });

  it("uses past schedules, completed counts and upcoming state without counting future broadcasts", () => {
    const now = 1_800_000_000_000;
    const pastOnly = prepareNativeAniListTarget({ ...media, nextAiringEpisode: null, airingEpisodes: [{ episode: 4, airingAt: now / 1000 - 1 }, { episode: 5, airingAt: now / 1000 + 1 }] }, now);
    expect(pastOnly.supported && pastOnly.target.season.latestAiredEpisode).toBe(4);
    expect(target({ ...media, nextAiringEpisode: null, status: "FINISHED" }).season.latestAiredEpisode).toBe(25);
    expect(target({ ...media, status: "NOT_YET_RELEASED" }).season.latestAiredEpisode).toBe(0);
  });

  it("rejects unknown total counts, unsafe IDs, cancelled works and ambiguous absolute numbering", () => {
    for (const update of [{ episodeCount: null }, { anilistId: -1 }, { anilistId: 3_000_000_000 }, { status: "CANCELLED" }, { nextAiringEpisode: { episode: 61, airingAt: 1_900_000_000 } }, { format: "MOVIE", mediaType: "movie" as const }]) {
      expect(prepareNativeAniListTarget({ ...media, ...update }).supported).toBe(false);
    }
  });

  it("retains explicitly configured mapping validation and fails closed on malformed configuration", async () => {
    vi.stubEnv("MEDIA_TRACK_ANILIST_MAPPINGS", "not-json");
    expect(await getAniListAcquisitionTarget(media)).toMatchObject({ supported: false });
    vi.stubEnv("MEDIA_TRACK_ANILIST_MAPPINGS", JSON.stringify([{ anilistId: 999, tmdbId: 111, seasonNumber: 3, episodeCount: 12, evidenceUrl: "https://example.com/evidence" }]));
    // A stale explicit mapping must not silently switch to a second native title.
    expect(await getAniListAcquisitionTarget(media)).toMatchObject({ supported: false });
  });

  it("separates media keys, links and directories for equal source IDs", async () => {
    const native = target().title;
    const tmdb = { ...native, source: "tmdb" as const, anilistId: undefined, tmdbId: 999 };
    expect(mediaKey(native)).not.toBe(mediaKey(tmdb));
    expect(mediaHref(native, "library", "drive-b")).toBe("/anime/anilist/999?from=library&w=drive-b");
    expect(mediaHref(tmdb, "search", undefined)).toBe("/show/999?from=search&t=anime");
    expect(mediaLibraryFolderName({ ...native, year: 2026 })).toContain("{anilist-999}");
    expect(mediaPosterUrl(native.posterPath)).toBe(media.posterUrl);
  });
});

const USAGE = { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } };
function acquisitionModel() {
  const steps = [
    ["readSkill", { section: "tv" }],
    ["transferCandidate", { snapshotId: "s1", candidateId: "s1-1" }],
    ["inspectStaging", {}],
    ["moveToSeason", { moves: [{ season: 1, fileIds: ["native-1", "native-2"] }] }],
    ["markObtained", { codes: ["S01E01", "S01E02"] }],
    ["discardStaging", {}], ["finish", {}],
  ] as const;
  let step = 0;
  return new MockLanguageModelV3({ doGenerate: async () => {
    const next = steps[step++];
    return next ? { content: [{ type: "tool-call" as const, toolCallId: `native-${step}`, toolName: next[0], input: JSON.stringify(next[1]) }], finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const }, usage: USAGE, warnings: [] }
      : { content: [{ type: "text" as const, text: "done" }], finishReason: { unified: "stop" as const, raw: "stop" as const }, usage: USAGE, warnings: [] };
  } });
}

describe("native AniList queue, original agent tools, storage and restart", () => {
  it("tracks an unknown airing schedule without inventing aired episodes or losing its unknown state", async () => {
    const native = target({ ...media, nextAiringEpisode: null });
    expect(native.season).toMatchObject({ latestAiredEpisode: 0, latestAiredSource: "unknown" });
    const repository = new InMemoryWorkflowRepository();
    await queueTrackingInitialization({ ...native, repository, createWorkflowRunId: () => "unknown-airing" });
    const neverRun = new MockLanguageModelV3({ doGenerate: async () => { throw new Error("No airing evidence: do not acquire future episodes"); } });
    await runQueuedType2Workflow({ repository, model: neverRun, resourceProvider: new FakeResourceProvider({ keywordResults: {} }), storage: new FakeStorageExecutor(), storageParentDirectoryId: "tv", animeStorageParentDirectoryId: "anime" });
    const result = await repository.getWorkflowRunSnapshot("unknown-airing");
    expect(result?.workflowRun.status).toBe("succeeded");
    expect(result?.season.latestAiredSource).toBe("unknown");
    expect(result?.episodes.some((episode) => episode.airStatus === "aired" || episode.obtained)).toBe(false);
  });

  it("persists/reopens, transfers and verifies two episodes, then patrols using the AniList ID", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anilist-native-"));
    const dbPath = join(dir, "workflow.sqlite");
    let repository = createSqliteWorkflowRepository({ path: dbPath });
    const scope = { accountId: "acct_default", connectedStorageId: "drive-b" };
    try {
      const native = target();
      const request = { ...native, repository, connectedStorageId: "drive-b", createWorkflowRunId: () => "native-run" };
      expect((await queueTrackingInitialization(request)).status).toBe("queued");
      expect((await queueTrackingInitialization(request)).status).toBe("already_running");
      repository.close();
      repository = createSqliteWorkflowRepository({ path: dbPath });
      const recovered = await repository.getWorkflowRunSnapshot("native-run");
      expect(recovered?.title).toMatchObject({ source: "anilist", tmdbId: null, anilistId: 999 });
      const provider = new FakeResourceProvider({ keywordResults: { [media.title]: [{ title: `${media.title} 01-02`, providerPayload: { url: "https://115.com/s/native-fixture" } }] } });
      const storage = new FakeStorageExecutor({ transferOutcomes: { snapshot_1_candidate_1: {
        status: "succeeded", providerMessage: "fixture transfer", files: [1, 2].map((n) => ({ id: `native-${n}`, providerFileId: `native-${n}`, name: `Nia.S01E0${n}.mkv`, storageDirectoryId: "staging", sizeBytes: 1000, episodeCode: `S01E0${n}` })),
      } } });
      const result = await runQueuedType2Workflow({ repository, resourceProvider: provider, storage, model: acquisitionModel(), storageParentDirectoryId: "tv-root", animeStorageParentDirectoryId: "anime-root" });
      expect(result.status).toBe("ran");
      const done = await repository.getWorkflowRunSnapshot("native-run");
      expect(done?.workflowRun.status).toBe("succeeded");
      expect(done?.episodes.filter((episode) => episode.obtained).map((episode) => episode.episodeCode)).toEqual(["S01E01", "S01E02"]);
      expect(done?.season.status).toBe("active"); // 2/25 aired is not a finished series.
      expect(done?.season.storageDirectoryId).toContain("{anilist-999}");
      expect(done?.transferAttempts.some((attempt) => attempt.status === "succeeded")).toBe(true);
      expect((await storage.listVideoFiles(done!.season.storageDirectoryId)).map((file) => file.id).sort()).toEqual(["native-1", "native-2"]);
      expect(done?.notifications[0]?.report).toMatchObject({ anilistId: 999, tmdbId: null, seasonLabel: null });
      expect(await repository.getTrackedSeasonState(native.season.id, { ...scope, connectedStorageId: "other-drive" })).toBeNull();
      const sync = vi.fn(async () => ({ latestAiredEpisode: 3, totalEpisodes: 25 }));
      await runScheduledType3Monitoring({ repository, resourceProvider: new FakeResourceProvider({ keywordResults: {} }), storage,
        model: createStubAcquisitionModel(), storageParentDirectoryId: "tv-root", animeStorageParentDirectoryId: "anime-root", syncSeasonMetadata: sync });
      expect(sync).toHaveBeenCalledWith({ tmdbId: null, anilistId: 999, seasonNumber: 1, accountId: "acct_default" });
      const refreshed = await repository.getTrackedSeasonState(native.season.id, scope);
      expect(refreshed?.season.latestAiredEpisode).toBe(3);
      expect(refreshed?.episodes.filter((episode) => episode.obtained)).toHaveLength(2);
      expect((await repository.untrackTitle(null, scope, "tv", undefined, 999)).status).toBe("untracked");
    } finally { repository.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps simultaneous native progress separate and cancellation removes only the selected entry", async () => {
    const repository = new InMemoryWorkflowRepository();
    for (const id of [999, 1000]) await queueTrackingInitialization({ ...target({ ...media, anilistId: id }), repository, connectedStorageId: "drive-b", createWorkflowRunId: () => `run-${id}` });
    const view = await getActivityView({ repository, accountId: "acct_default", connectedStorageId: "drive-b" });
    expect(findActiveRun(view.active, null, 1, 999)?.runId).toBe("run-999");
    expect(findActiveRun(view.active, null, 1, 1000)?.runId).toBe("run-1000");
    expect(findActiveRun(view.active, null, 1)).toBeNull();
    await repository.cancelQueuedWorkflowRun("run-999", { accountId: "acct_default", connectedStorageId: "drive-b" });
    expect((await repository.listActiveWorkflowRuns()).map((run) => run.title.anilistId)).toEqual([1000]);
  });
});
