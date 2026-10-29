import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncLibraryFromDrive, parseLibraryFolder } from "../src/library-drive-sync.js";
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
  const input = { storage, repository, scope, categories: [{ id: "movies", type: "movie" as const }, { id: "tv", type: "tv" as const }, { id: "anime", type: "anime" as const }], resolveTarget };
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
  it("is idempotent and preserves existing records and episodes", async () => {
    const f = fixture(); await syncLibraryFromDrive(f.input);
    const before = await f.repository.listTrackedSeasonStates(scope);
    f.trees.s2!.push(file("new.S02E03.mkv"));
    expect(await syncLibraryFromDrive(f.input)).toMatchObject({ imported: 0, existing: 3, episodes: 0 });
    expect(await f.repository.listTrackedSeasonStates(scope)).toEqual(before);
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
    expect(parseLibraryFolder("作品 (2026) {anilist-30}", "movie")).toBeNull();
    expect(parseLibraryFolder("作品 (2026) {tmdb-0}", "tv")).toBeNull();
  });
});

describe("SQLite durable recovery", () => {
  const paths: string[] = [];
  afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });
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
