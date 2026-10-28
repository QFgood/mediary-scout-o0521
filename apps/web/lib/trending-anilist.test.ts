import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./workflow-runtime", () => ({
  getTmdbAccesses: vi.fn(async () => []), getAccountScopedSettings: vi.fn(() => ({ getSetting: async () => null })), getCurrentAccountId: vi.fn(async () => "account"),
}));
vi.mock("@media-track/workflow", () => ({ fetchTmdbList: vi.fn() }));

import { fetchTmdbList } from "@media-track/workflow";
import { anilistClient } from "./anilist/client";
import { getTrending } from "./trending";
import { TrendingRow } from "../components/trending-row";
import { MetadataSourceTabs } from "../components/metadata-source-tabs";

const anime = { source: "anilist" as const, anilistId: 999, title: "同名续作", originalTitle: "同名续作", aliases: [], mediaType: "anime" as const, year: 2026, posterUrl: "https://s4.anilist.co/poster.jpg", overview: "", episodeCount: 12 };

describe("AniList discovery and independent TMDB fallback", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.mocked(fetchTmdbList).mockReset(); });

  it("sources anime from AniList and retains exact identity/image URLs", async () => {
    vi.spyOn(anilistClient, "trending").mockResolvedValue([anime]);
    const cards = await getTrending("anime", "season");
    expect(cards[0]).toMatchObject({ source: "anilist", anilistId: 999, posterUrl: anime.posterUrl });
    expect(cards[0]).not.toHaveProperty("tmdbId");
    expect(fetchTmdbList).not.toHaveBeenCalled();
  });

  it("falls back to the original TMDB anime feed when AniList/cache is unavailable", async () => {
    vi.spyOn(anilistClient, "trending").mockRejectedValue(new Error("offline"));
    vi.mocked(fetchTmdbList).mockResolvedValue({ results: [{ id: 42, name: "fallback" }] });
    expect(await getTrending("anime")).toMatchObject([{ tmdbId: 42, title: "fallback" }]);
    expect(fetchTmdbList).toHaveBeenCalledWith([], "discover/tv", expect.objectContaining({ with_original_language: "ja" }));
  });

  it("never calls AniList for movie/TV feeds and degrades safely if both services fail", async () => {
    const ani = vi.spyOn(anilistClient, "trending").mockRejectedValue(new Error("offline"));
    vi.mocked(fetchTmdbList).mockResolvedValue({ results: [{ id: 1, title: "Movie" }] });
    expect(await getTrending("movie")).toHaveLength(1);
    expect(await getTrending("tv")).toHaveLength(1);
    expect(ani).not.toHaveBeenCalled();
    vi.mocked(fetchTmdbList).mockRejectedValue(new Error("also offline"));
    await expect(getTrending("anime")).resolves.toEqual([]);
  });

  it("renders existing poster cards with exact AniList selection, workspace and source", async () => {
    vi.spyOn(anilistClient, "trending").mockResolvedValue([anime]);
    const markup = renderToStaticMarkup(await TrendingRow({ activeKind: "anime", basePath: "/w/drive-b", source: "anilist", animeFeed: "season" }));
    expect(markup).toContain('src="https://s4.anilist.co/poster.jpg"');
    expect(markup).not.toContain("w342https");
    expect(markup).toContain("anilistId=999");
    expect(markup).toContain("source=anilist");
    expect(markup).toContain("/w/drive-b?");
    expect(markup).toContain("当季动画");
    expect(markup).toContain("即将播出");
    expect(markup).toContain("来自 AniList");
  });

  it("labels fallback honestly and sends fallback cards to TMDB", async () => {
    vi.spyOn(anilistClient, "trending").mockRejectedValue(new Error("offline"));
    vi.mocked(fetchTmdbList).mockResolvedValue({ results: [{ id: 42, name: "fallback", poster_path: "/a.jpg" }] });
    const markup = renderToStaticMarkup(await TrendingRow({ activeKind: "anime", basePath: "/", source: "anilist" }));
    expect(markup).toContain("TMDB（AniList 暂不可用）");
    expect(markup).toContain("source=tmdb");
    expect(markup).not.toContain("anilistId=42");
  });

  it("switches sources independently, retaining the query and active workspace", () => {
    const markup = renderToStaticMarkup(MetadataSourceTabs({ source: "anilist", query: "续作 & third", basePath: "/w/b" }));
    expect(markup).toContain("TMDB 元数据");
    expect(markup).toContain("AniList 元数据");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("/w/b?tab=search&amp;source=anilist");
    expect(markup).toContain("q=%E7%BB%AD%E4%BD%9C+%26+third");
  });
});
