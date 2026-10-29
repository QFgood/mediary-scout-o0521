import { describe, expect, it, vi } from "vitest";
import {
  ensureMediaLibraryDirectory,
  legacyMediaLibraryFolderName,
  mediaLibraryFolderName,
} from "../src/media-library-folder.js";
import { canonicalEpisodeFileName, episodeCodeFromFileName } from "../src/episode-code.js";
import { ensureSeasonAcquisitionDirectories } from "../src/acquisition-v2/directory-lifecycle.js";
import { parseLibraryFolder } from "../src/library-drive-sync.js";
import { FakeStorageExecutor } from "../src/fakes.js";

describe("mediaLibraryFolderName", () => {
  it("formats Title (Year) {tmdb-id}", () => {
    expect(mediaLibraryFolderName({ title: "2001太空漫游", year: 1968, tmdbId: 62 })).toBe(
      "2001太空漫游 (1968) {tmdb-62}",
    );
  });

  it("falls back year to em-dash when missing or zero", () => {
    expect(mediaLibraryFolderName({ title: "X", year: null, tmdbId: 1 })).toBe("X (—) {tmdb-1}");
    expect(mediaLibraryFolderName({ title: "X", year: 0, tmdbId: 1 })).toBe("X (—) {tmdb-1}");
    expect(legacyMediaLibraryFolderName({ title: "X", year: undefined })).toBe("X (—)");
  });
});

describe("ensureMediaLibraryDirectory", () => {
  it("creates the new-format name when parent is empty", async () => {
    const executor = new FakeStorageExecutor();
    const id = await ensureMediaLibraryDirectory({
      executor,
      parentId: "movies_root",
      title: "盗梦空间",
      year: 2010,
      tmdbId: 27205,
    });
    const kids = await executor.listChildDirectories("movies_root");
    expect(kids).toEqual([{ id, name: "盗梦空间 (2010) {tmdb-27205}" }]);
  });

  it("reuses legacy Title (Year) without creating a duplicate", async () => {
    const executor = new FakeStorageExecutor();
    const legacyId = await executor.createDirectory({
      name: "盗梦空间 (2010)",
      parentId: "movies_root",
    });
    const id = await ensureMediaLibraryDirectory({
      executor,
      parentId: "movies_root",
      title: "盗梦空间",
      year: 2010,
      tmdbId: 27205,
    });
    expect(id).toBe(legacyId);
    const kids = await executor.listChildDirectories("movies_root");
    expect(kids).toHaveLength(1);
    expect(kids[0]!.name).toBe("盗梦空间 (2010)");
  });

  it("prefers the new-format name when both could exist", async () => {
    const executor = new FakeStorageExecutor();
    await executor.createDirectory({ name: "Show (2024)", parentId: "tv_root" });
    const preferredId = await executor.createDirectory({
      name: "Show (2024) {tmdb-99}",
      parentId: "tv_root",
    });
    const id = await ensureMediaLibraryDirectory({
      executor,
      parentId: "tv_root",
      title: "Show",
      year: 2024,
      tmdbId: 99,
    });
    expect(id).toBe(preferredId);
  });
});

describe("cloud title punctuation compatibility", () => {
  const title = "サイバーパンク: エッジランナーズ2";
  const input = { title, year: 2026, tmdbId: null, anilistId: 195539 };
  const safeName = "サイバーパンク： エッジランナーズ2 (2026) {anilist-195539}";
  it("escapes storage names while retaining the native title and source ID", () => {
    expect(mediaLibraryFolderName(input)).toBe(safeName);
    expect(input.title).toBe(title);
    expect(parseLibraryFolder(safeName, "anime")).toMatchObject({ source: "anilist", id: 195539 });
    const file = canonicalEpisodeFileName({ title, episodeCode: "S01E01", sourceName: "001.mkv" });
    expect(file).toBe("サイバーパンク： エッジランナーズ2.S01E01.mkv");
    expect(episodeCodeFromFileName(file)).toBe("S01E01");
  });
  it("handles other forbidden punctuation and control characters without changing valid Unicode", () => {
    const name = mediaLibraryFolderName({ title: ' A/B\\C:D*E?F"G<H>I|J\n ', year: 2026, tmdbId: 1 });
    expect(name).toBe("A／B＼C：D＊E？F＂G＜H＞I｜J (2026) {tmdb-1}");
    expect(mediaLibraryFolderName({ title: "普通の作品・第二期", year: 2026, tmdbId: 1 })).toBe("普通の作品・第二期 (2026) {tmdb-1}");
  });
  it("creates safe root/season/staging directories on a rejecting drive, and reuses them", async () => {
    const executor = new FakeStorageExecutor();
    const create = executor.createDirectory.bind(executor);
    const writes = vi.spyOn(executor, "createDirectory").mockImplementation(async (value) => {
      if (/[:/\\*?"<>|]/.test(value.name)) throw new Error("QUARK_CREATE_FOLDER_FAILED: code=14012 bad file name");
      return create(value);
    });
    const result = await ensureSeasonAcquisitionDirectories({ executor, categoryParentId: "anime", showName: title, year: 2026,
      tmdbId: null, anilistId: 195539, seasons: [1], workflowRunId: "test" });
    expect((await executor.listChildDirectories("anime"))[0]?.name).toBe(safeName);
    expect(await ensureMediaLibraryDirectory({ ...input, executor, parentId: "anime" })).toBe(result.showDirectoryId);
    expect(writes.mock.calls.filter(([value]) => value.parentId === "anime")).toHaveLength(1);
  });
  it("reuses old raw tagged directories accepted by other providers", async () => {
    const executor = new FakeStorageExecutor();
    const id = await executor.createDirectory({ name: `${title} (2026) {anilist-195539}`, parentId: "anime" });
    expect(await ensureMediaLibraryDirectory({ ...input, executor, parentId: "anime" })).toBe(id);
    expect(await executor.listChildDirectories("anime")).toHaveLength(1);
  });
  it("still reuses legacy TMDB directories but never adopts an untagged AniList folder", async () => {
    const executor = new FakeStorageExecutor();
    const id = await executor.createDirectory({ name: `${title} (2026)`, parentId: "anime" });
    expect(await ensureMediaLibraryDirectory({ ...input, tmdbId: 10, executor, parentId: "anime" })).toBe(id);
    expect(await ensureMediaLibraryDirectory({ ...input, executor, parentId: "anime" })).not.toBe(id);
  });
});
