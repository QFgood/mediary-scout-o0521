import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { isMovieUnreleased, runScheduledType3Monitoring, syncLibraryFromDrive, FakeResourceProvider, FakeStorageExecutor } from "@media-track/workflow";
import { prepareNativeAniListTarget } from "./native-target";
import { getAniListAcquisitionTarget } from "./task";
import type { AniListMetadata } from "./mapper";

const mocks = vi.hoisted(() => ({ details: vi.fn() }));
vi.mock("./server-client", () => ({ getAniListClient: async () => ({ details: mocks.details }) }));
const movie: AniListMetadata = { source: "anilist", anilistId: 900, title: "薬屋のひとりごと 亡妃の秘宝", originalTitle: "薬屋のひとりごと 亡妃の秘宝", aliases: [], mediaType: "movie", year: 2027, releaseDate: null, format: "MOVIE", status: "NOT_YET_RELEASED", posterUrl: null, overview: "", episodeCount: null };
let runtime: typeof import("../workflow-runtime");
beforeEach(async () => {
  vi.stubEnv("MEDIA_TRACK_SQLITE_PATH", ":memory:"); vi.stubEnv("MEDIA_TRACK_POSTGRES_URL", ""); vi.stubEnv("MEDIA_TRACK_MULTI_USER", "0");
  vi.stubEnv("MEDIA_TRACK_WORKFLOW_ADAPTER", "fake"); vi.stubEnv("MEDIA_TRACK_STORAGE_ADAPTER", "fake"); vi.stubEnv("MEDIA_TRACK_AGENT_ADAPTER", "fake"); vi.stubEnv("MEDIA_TRACK_ANILIST_MAPPINGS", "");
  vi.resetModules(); mocks.details.mockReset(); mocks.details.mockResolvedValue(movie);
  runtime = await import("../workflow-runtime");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
function target(media = movie) {
  const result = prepareNativeAniListTarget(media); if (!result.supported) throw new Error(result.reason); return result.target;
}
describe("native AniList movies", () => {
  it("restores an existing native movie folder through the new library sync", async () => {
    const repo = runtime.getWorkflowRepository();
    const result = await syncLibraryFromDrive({ repository: repo, scope: { accountId: "acct_default", connectedStorageId: null }, categories: [{ id: "movies", type: "movie" }],
      storage: { listChildDirectories: async () => [{ id: "cloud-film", name: "Movie (2027) {anilist-900}" }], listTree: async () => [{ path: "Movie.mkv", providerFileId: "real-movie-file", sizeBytes: 1000000 }] },
      resolveTarget: async () => target({ ...movie, status: "FINISHED" }),
    });
    expect(result).toMatchObject({ imported: 1, episodes: 1, issues: [] });
    const [state] = await repo.listTrackedSeasonStates("acct_default");
    expect(state).toMatchObject({ title: { tmdbId: null, anilistId: 900, type: "movie" }, season: { storageDirectoryId: "cloud-film" } });
    expect(state?.episodes[0]?.verifiedFileIds).toEqual(["real-movie-file"]);
  });
  it("supports MOVIE without episode count, exact date, TMDB key or TV season mappings", async () => {
    vi.stubEnv("MEDIA_TRACK_ANILIST_MAPPINGS", "invalid TV-only mapping");
    const result = await getAniListAcquisitionTarget(movie);
    expect(result).toMatchObject({ supported: true, mode: "native", target: { title: { tmdbId: null, anilistId: 900, type: "movie", releaseDate: null, anilistStatus: "NOT_YET_RELEASED" }, season: { id: "anilist_anime_900_movie" } } });
    expect(isMovieUnreleased(null, "2030-01-01", movie.status!)).toBe(true);
    expect(isMovieUnreleased("2031-01-01", "2030-01-01", "FINISHED")).toBe(false);
  });
  it("reserves once, creates no queued download, and rejects forcing a pre-release acquisition", async () => {
    expect((await runtime.reserveCandidate("anilist_anime_900")).status).toBe("reserved");
    expect((await runtime.reserveCandidate("anilist_anime_900")).status).toBe("already_tracked");
    expect((await runtime.queueCandidateTracking("anilist_anime_900")).status).toBe("unsupported");
    const repo = runtime.getWorkflowRepository();
    const [state] = await repo.listTrackedSeasonStates("acct_default");
    expect(state?.title.tmdbId).toBeNull(); expect(state?.episodes.some((e) => e.obtained)).toBe(false);
    expect(await repo.claimNextQueuedWorkflowRun({ kind: "movie_init", now: "2030-01-01T00:00:00Z" })).toBeNull();
  });
  it("rechecks movie type and supports released movies through the movie queue", async () => {
    mocks.details.mockResolvedValueOnce({ ...movie, format: "TV", mediaType: "anime", episodeCount: 12 });
    expect((await runtime.reserveCandidate("anilist_anime_900")).status).toBe("unsupported");
    mocks.details.mockResolvedValue({ ...movie, status: "FINISHED" });
    expect((await runtime.queueCandidateTracking("anilist_anime_900")).status).toBe("queued");
    const run = await runtime.getWorkflowRepository().claimNextQueuedWorkflowRun({ kind: "movie_init", now: new Date().toISOString() });
    expect(run?.title.type).toBe("movie"); expect(run?.title.tmdbId).toBeNull();
  });
  it("retains reservation while unreleased or metadata unavailable, then patrols after release using native folder identity", async () => {
    await runtime.reserveCandidate("anilist_anime_900");
    const generate = vi.fn(async () => ({ content: [{ type: "tool-call" as const, toolCallId: "no-resource", toolName: "reportNoCoverage", input: JSON.stringify({ reason: "test has no resources" }) }], finishReason: { unified: "tool-calls" as const, raw: "tool-calls" as const }, usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } }, warnings: [] }));
    const storage = new FakeStorageExecutor();
    const create = vi.spyOn(storage, "createDirectory");
    const deps = { repository: runtime.getWorkflowRepository(), storage, resourceProvider: new FakeResourceProvider({ keywordResults: {} }), model: new MockLanguageModelV3({ doGenerate: generate }), storageParentDirectoryId: "tv", moviesParentDirectoryId: "movies", now: () => "2030-01-01T00:00:00Z" };
    expect(await runScheduledType3Monitoring({ ...deps, syncSeasonMetadata: async () => ({ title: target().title, latestAiredEpisode: 0, totalEpisodes: 1 }) })).toEqual([]);
    expect(await runScheduledType3Monitoring({ ...deps, syncSeasonMetadata: async () => { throw new Error("offline"); } })).toEqual([]);
    expect(generate).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    const released = target({ ...movie, status: "FINISHED" });
    const outcomes = await runScheduledType3Monitoring({ ...deps, syncSeasonMetadata: async () => ({ title: released.title, latestAiredEpisode: 1, totalEpisodes: 1 }) });
    expect(outcomes).toHaveLength(1); expect(generate).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining("{anilist-900}"), parentId: "movies" }));
    expect((await deps.repository.listTrackedSeasonStates("acct_default"))[0]?.title.anilistStatus).toBe("FINISHED");
  });
});
