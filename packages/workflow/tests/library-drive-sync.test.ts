import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncLibraryFromDrive, parseLibraryFolder, libraryEpisodeCode } from "../src/library-drive-sync.js";
import { InMemoryWorkflowRepository, type WorkflowRepository } from "../src/repository.js";
import { createSqliteWorkflowRepository } from "../src/sqlite.js";
import { movieAnchorSeason, type MediaTitle, type PackageTreeFile } from "../src/domain.js";

const scope = { accountId: "acct_default", connectedStorageId: "drive_a" };
const file = (path: string, id = path): PackageTreeFile => ({ path, providerFileId: id, sizeBytes: 1_000_000 });
function fixture(repository: WorkflowRepository = new InMemoryWorkflowRepository()) {
  const children: Record<string, Array<{ id: string; name: string }>> = {
    movies: [{ id: "movie", name: "电影 (2025) {tmdb-10}" }],
    tv: [{ id: "show", name: "剧集 (2024) {tmdb-20}" }],
    anime: [{ id: "anime-title", name: "动画 (2026) {anilist-30}" }],
    show: [{ id: "s2", name: "Season 2" }], "anime-title": [{ id: "a1", name: "Season 1" }],
  };
  const trees: Record<string, PackageTreeFile[]> = {
    movie: [file("电影.mp4"), file("sample.mp4"), file("字幕.srt")],
    s2: [file("剧集.S02E01.mkv"), file("剧集.S02E02.mkv"), file("staging/剧集.S02E03.mkv")],
    a1: [file("动画.S01E01.mkv"), file("动画.S01E02.mp4")],
  };
  const storage = { listChildDirectories: vi.fn(async (id: string) => children[id] ?? []), listTree: vi.fn(async ({ directoryId }: { directoryId: string }) => trees[directoryId] ?? []), deleteFiles: vi.fn(), moveFiles: vi.fn(), createDirectory: vi.fn(), transfer: vi.fn(), renameFile: vi.fn() };
  const resolveTarget = vi.fn(async (folder: NonNullable<ReturnType<typeof parseLibraryFolder>>, number: number) => {
    const id = folder.source === "anilist" ? `anilist_anime_${folder.id}` : `tmdb_${folder.category === "movie" ? "movie" : "tv"}_${folder.id}`;
    const title: MediaTitle = { id, title: folder.title, originalTitle: folder.title, year: folder.year, type: folder.category, tmdbId: folder.source === "anilist" ? null : folder.id!, aliases: [], ...(folder.source === "anilist" ? { source: "anilist", anilistId: folder.id! } : {}) };
    return { title, season: folder.category === "movie" ? movieAnchorSeason({ titleId: id, qualityPreference: "4K", storageDirectoryId: "" }) : { id: `${id}_s${number}`, mediaTitleId: id, seasonNumber: number, status: "active" as const, qualityPreference: "4K", storageDirectoryId: "", totalEpisodes: 12, latestAiredEpisode: 4, latestAiredSource: "metadata" as const } };
  });
  const input = { storage, repository, scope, queueMissing: false, categories: [{ id: "movies", type: "movie" as const }, { id: "tv", type: "tv" as const }, { id: "anime", type: "anime" as const }], resolveTarget };
  return { input, children, trees, storage, repository, resolveTarget };
}

describe("drive library recovery", () => {
  it("restores movies, TV season 2 and native AniList with actual file IDs, without any drive mutations", async () => {
    const f = fixture();
    expect(await syncLibraryFromDrive(f.input)).toMatchObject({ imported: 3, episodes: 5, existing: 0, issues: [] });
    const states = await f.repository.listTrackedSeasonStates(scope);
    expect(states).toHaveLength(3);
    const anime = states.find((s) => s.title.anilistId === 30)!;
    expect(anime.title.tmdbId).toBeNull();
    expect(anime.episodes.filter((e) => e.obtained).map((e) => e.episodeCode)).toEqual(["S01E01", "S01E02"]);
    expect(states.find((s) => s.season.seasonNumber === 2)?.season.storageDirectoryId).toBe("s2");
    for (const method of [f.storage.deleteFiles, f.storage.moveFiles, f.storage.createDirectory, f.storage.transfer, f.storage.renameFile]) expect(method).not.toHaveBeenCalled();
    expect(await f.repository.claimNextQueuedWorkflowRun({ kind: "type2_init", now: new Date().toISOString() })).toBeNull();
  });
  it("rescans existing records, repairs newly found episodes, and remains idempotent", async () => {
    const f = fixture(); await syncLibraryFromDrive(f.input);
    const before = await f.repository.listTrackedSeasonStates(scope);
    f.trees.s2!.push(file("new.S02E03.mkv"));
    expect(await syncLibraryFromDrive(f.input)).toMatchObject({ imported: 0, existing: 3, episodes: 1, updated: 1 });
    const after = await f.repository.listTrackedSeasonStates(scope);
    expect(after.find((s) => s.season.id.endsWith("_s2"))?.episodes.find((e) => e.episodeCode === "S02E03")?.obtained).toBe(true);
    expect(after.find((s) => s.title.type === "movie")).toEqual(before.find((s) => s.title.type === "movie"));
    expect(await syncLibraryFromDrive(f.input)).toMatchObject({ imported: 0, existing: 3, episodes: 0, updated: 0 });
  });
  it("recognizes numeric agent names in their confirmed season only, refusing resolutions and out-of-range numbers", () => {
    expect(libraryEpisodeCode("001.mkv", 1, 209)).toBe("S01E01");
    expect(libraryEpisodeCode("002.MP4", 2, 12)).toBe("S02E02");
    for (const name of ["000.mkv", "1080.mkv", "2026.mp4", "title.001.mkv", "01-12.mkv", "extras/001.mkv"]) expect(libraryEpisodeCode(name, 1, 209)).toBeNull();
    expect(libraryEpisodeCode("001.mkv", 1, 0)).toBeNull();
  });
  it("repairs legacy 001.mkv marks without queuing duplicates, including later seasons", async () => {
    const f = fixture(); await syncLibraryFromDrive(f.input);
    f.trees.a1 = [file("001.mkv"), file("002.mkv"), file("003.mkv"), file("004.mkv")];
    f.trees.s2 = [file("001.mkv"), file("002.mkv"), file("003.mkv"), file("004.mkv")];
    const report = await syncLibraryFromDrive({ ...f.input, queueMissing: true });
    expect(report).toMatchObject({ updated: 2, episodes: 4, queued: 0, missingEpisodes: 0, issues: [] });
    expect((await f.repository.getTrackedSeasonState("tmdb_tv_20_s2", scope))?.episodes.find((e) => e.episodeCode === "S02E03")?.verifiedFileIds).toEqual(["003.mkv"]);
  });
  it("queues only truly missing aired episodes and never duplicates an active refill", async () => {
    const f = fixture(); f.trees.a1 = [file("001.mkv"), file("002.mkv"), file("004.mkv")];
    const report = await syncLibraryFromDrive({ ...f.input, queueMissing: true });
    expect(report).toMatchObject({ queued: 2, missingEpisodes: 3 });
    const run = await f.repository.findActiveWorkflowRun({ ...scope, trackedSeasonId: "anilist_anime_30_s1", kind: "type2_init" });
    expect(run?.workflowRun.auditEvents[0]?.data).toEqual({ episodes: ["S01E03"] });
    expect(run?.episodes.filter((e) => e.obtained).map((e) => e.episodeCode)).toEqual(["S01E01", "S01E02", "S01E04"]);
    expect((await syncLibraryFromDrive({ ...f.input, queueMissing: true })).queued).toBe(0);
  });
  it("repairs the reported 1/197/209 false gap using 001.mkv through 197.mkv", async () => {
    const f = fixture();
    f.input.categories = [{ id: "anime", type: "anime" }];
    const impl = f.resolveTarget.getMockImplementation()!;
    f.resolveTarget.mockImplementation(async (folder, number) => { const target = await impl(folder, number); return { ...target, season: { ...target.season, totalEpisodes: 209, latestAiredEpisode: 197 } }; });
    f.trees.a1 = [file("动画.S01E197.mkv")];
    await syncLibraryFromDrive(f.input);
    f.trees.a1 = Array.from({ length: 197 }, (_, i) => file(`${String(i + 1).padStart(3, "0")}.mkv`));
    expect(await syncLibraryFromDrive({ ...f.input, queueMissing: true })).toMatchObject({ imported: 0, updated: 1, episodes: 196, queued: 0, missingEpisodes: 0 });
    expect((await f.repository.listTrackedSeasonStates(scope))[0]?.episodes.filter((e) => e.obtained)).toHaveLength(197);
  });
  it("does not queue refill when any video remains unrecognized or metadata is unavailable", async () => {
    const f = fixture(); f.trees.a1!.push(file("unrecognized.mkv"));
    const report = await syncLibraryFromDrive({ ...f.input, queueMissing: true });
    expect(report.queued).toBe(1);
    expect(await f.repository.findActiveWorkflowRun({ ...scope, trackedSeasonId: "anilist_anime_30_s1", kind: "type2_init" })).toBeNull();
    const g = fixture(); await syncLibraryFromDrive(g.input); g.trees.a1!.push(file("003.mkv"));
    g.resolveTarget.mockRejectedValue(new Error("metadata unavailable"));
    expect(await syncLibraryFromDrive({ ...g.input, queueMissing: true })).toMatchObject({ updated: 1, queued: 0 });
  });
  it("refreshes aired counts before deciding which episodes to queue", async () => {
    const f = fixture(); await syncLibraryFromDrive(f.input);
    const impl = f.resolveTarget.getMockImplementation()!;
    f.resolveTarget.mockImplementation(async (folder, number) => { const target = await impl(folder, number); return { ...target, season: { ...target.season, latestAiredEpisode: 5 } }; });
    const report = await syncLibraryFromDrive({ ...f.input, queueMissing: true });
    expect(report).toMatchObject({ missingEpisodes: 6, queued: 2 });
  });
  it("does not recreate a season cancelled while metadata is being read", async () => {
    const f = fixture(); await syncLibraryFromDrive(f.input);
    const impl = f.resolveTarget.getMockImplementation()!;
    f.resolveTarget.mockImplementation(async (folder, number) => {
      if (folder.id === 20) await f.repository.untrackTitle(20, scope, "tv", 2);
      return impl(folder, number);
    });
    await syncLibraryFromDrive({ ...f.input, queueMissing: true });
    expect(await f.repository.getTrackedSeasonState("tmdb_tv_20_s2", scope)).toBeNull();
    expect(await f.repository.findActiveWorkflowRun({ ...scope, trackedSeasonId: "tmdb_tv_20_s2", kind: "type2_init" })).toBeNull();
  });
  it("marks a fully aired and fully restored series complete", async () => {
    const f = fixture(); const actual = f.resolveTarget.getMockImplementation()!;
    f.resolveTarget.mockImplementation(async (folder, number) => { const target = await actual(folder, number); return { ...target, season: { ...target.season, totalEpisodes: 2, latestAiredEpisode: 2 } }; });
    await syncLibraryFromDrive(f.input);
    const anime = (await f.repository.listTrackedSeasonStates(scope)).find((s) => s.title.anilistId === 30)!;
    expect(anime.season.status).toBe("completed");
  });
  it("does not mix accounts or drives", async () => {
    const f = fixture(); await syncLibraryFromDrive(f.input);
    expect(await f.repository.listTrackedSeasonStates({ ...scope, accountId: "other" })).toEqual([]);
    expect(await f.repository.listTrackedSeasonStates({ ...scope, connectedStorageId: "drive_b" })).toEqual([]);
    expect((await syncLibraryFromDrive({ ...f.input, scope: { ...scope, connectedStorageId: "drive_b" } })).imported).toBe(3);
  });
  it("reports unknown folders, mismatched episodes and metadata failures, continuing with other works", async () => {
    const f = fixture();
    f.children.movies!.push({ id: "unknown", name: "unknown" });
    f.trees.s2 = [file("wrong.S01E01.mkv"), file("without-number.mp4")];
    const actual = f.resolveTarget.getMockImplementation()!;
    f.resolveTarget.mockImplementation(async (folder, number) => { if (folder.source === "anilist") throw new Error("metadata unavailable"); return actual(folder, number); });
    const report = await syncLibraryFromDrive(f.input);
    expect(report.imported).toBe(1);
    expect(report.issues.some((item) => item.name === "unknown")).toBe(true);
    expect(report.issues.some((item) => item.reason.includes("集号"))).toBe(true);
    expect(report.issues.some((item) => item.name.includes("动画"))).toBe(true);
  });
  it("does not overwrite a queued acquisition reserved during scanning", async () => {
    const f = fixture();
    f.resolveTarget.mockImplementationOnce(async (folder, number) => {
      const target = { title: { id: "tmdb_movie_10", tmdbId: 10, type: "movie" as const, title: folder.title, originalTitle: folder.title, year: 2025, aliases: [] }, season: movieAnchorSeason({ titleId: "tmdb_movie_10", qualityPreference: "4K", storageDirectoryId: "" }) };
      await f.repository.saveWorkflowRunSnapshot({ ...scope, ...target, workflowRun: { id: "busy", kind: "movie_init", status: "queued", trackedSeasonId: target.season.id, startedAt: new Date().toISOString(), finishedAt: null, auditEvents: [] }, episodes: [], resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [] });
      return target;
    });
    expect((await syncLibraryFromDrive(f.input)).existing).toBe(1);
    expect((await f.repository.getWorkflowRunSnapshot("busy", scope))?.workflowRun.status).toBe("queued");
  });
  it("parses source-specific identity and legacy names without guessing IDs", () => {
    expect(parseLibraryFolder("作品 (2026) {anilist-30}", "anime")).toMatchObject({ source: "anilist", id: 30 });
    expect(parseLibraryFolder("作品 (2026)", "tv")).not.toHaveProperty("id");
    expect(parseLibraryFolder("作品 (2026) {anilist-30}", "tv")).toBeNull();
    expect(parseLibraryFolder("作品 (2026) {tmdb-0}", "tv")).toBeNull();
  });
});

describe("SQLite durable recovery", () => {
  const paths: string[] = [];
  afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
  it("persists repaired numeric episodes and refill tasks across restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "library-refill-")); paths.push(directory);
    const path = join(directory, "library.sqlite");
    let repo = createSqliteWorkflowRepository({ path });
    try {
      const f = fixture(repo); await syncLibraryFromDrive(f.input);
      f.trees.a1!.push(file("003.mkv"));
      expect(await syncLibraryFromDrive({ ...f.input, queueMissing: true })).toMatchObject({ updated: 1, queued: 2 });
    } finally { repo.close(); }
    repo = createSqliteWorkflowRepository({ path });
    try {
      const run = await repo.findActiveWorkflowRun({ ...scope, trackedSeasonId: "anilist_anime_30_s1", kind: "type2_init" });
      expect(run?.workflowRun.status).toBe("queued");
      expect(run?.workflowRun.auditEvents[0]?.data).toEqual({ episodes: ["S01E04"] });
      expect(run?.episodes.find((e) => e.episodeCode === "S01E03")?.verifiedFileIds).toEqual(["003.mkv"]);
    } finally { repo.close(); }
  });
  it("survives repository restart and remains idempotent", async () => {
    const directory = mkdtempSync(join(tmpdir(), "library-sync-")); paths.push(directory);
    const path = join(directory, "library.sqlite");
    let repo = createSqliteWorkflowRepository({ path });
    try { expect((await syncLibraryFromDrive(fixture(repo).input)).imported).toBe(3); }
    finally { repo.close(); }
    repo = createSqliteWorkflowRepository({ path });
    try {
      expect(await repo.listTrackedSeasonStates(scope)).toHaveLength(3);
      expect((await syncLibraryFromDrive(fixture(repo).input)).existing).toBe(3);
    } finally { repo.close(); }
  });
});
