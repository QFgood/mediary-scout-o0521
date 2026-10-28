import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapAniListMedia } from "../lib/anilist/mapper";

const mock = vi.hoisted(() => ({ search: vi.fn(), trending: vi.fn(), getTrending: vi.fn() }));
vi.mock("../lib/anilist/client", () => ({ anilistClient: { search: mock.search, trending: mock.trending } }));
vi.mock("../lib/trending", () => ({
  getTrending: mock.getTrending,
  TRENDING_KIND_ORDER: ["movie", "tv", "anime"],
  TRENDING_KINDS: { movie: { label: "热门电影" }, tv: { label: "热门剧集" }, anime: { label: "热门动漫" } },
}));
vi.mock("next/link", () => ({ default: "a" }));

import { AniListMediaCard, AniListSearchResults } from "./anilist-results";
import { TrendingRow } from "./trending-row";
import { MetadataSourceTabs } from "./metadata-source-tabs";

const media = mapAniListMedia({
  id: 123, type: "ANIME", title: { native: "薬屋 第3期" }, season: "FALL", seasonYear: 2027,
  episodes: null, description: "<script>example</script>Story", format: "TV",
  coverImage: { large: "https://s4.anilist.co/file/anilistcdn/a.jpg" },
  relations: { edges: [{ relationType: "PREQUEL", node: { id: 122, type: "ANIME", title: { native: "第二季" } } }] },
})!;

beforeEach(() => { vi.resetAllMocks(); });

describe("AniList search and discovery UI", () => {
  it("renders a sequel's own id, disables acquisition and preserves workspace on detail links", () => {
    const html = renderToStaticMarkup(createElement(AniListMediaCard, { media, basePath: "/w/quark-1", storageId: "quark-1", details: true }));
    expect(html).toContain('data-media-id="anilist_123"');
    expect(html).toContain('/anime/anilist/123?w=quark-1');
    expect(html).toContain('/anime/anilist/122?w=quark-1');
    expect(html).toContain("获取（暂不兼容）");
    expect(html).toContain("disabled");
    expect(html).toContain("集数未公布");
    expect(html).toContain("播出档期");
    expect(html).toContain("source=tmdb");
    expect(html).not.toContain("/show/123");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("tmdb_tv_123");
  });

  it("switches sources without losing query or workspace", () => {
    const html = renderToStaticMarkup(createElement(MetadataSourceTabs, { source: "anilist", query: "薬屋", basePath: "/w/quark-1" }));
    expect(html).toContain("/w/quark-1?tab=search");
    expect(html).toContain("source=tmdb");
    expect(html).toContain("source=anilist");
    expect(html).toContain('aria-current="page"');
  });

  it("renders search results and a cache indicator without invoking discovery", async () => {
    mock.search.mockResolvedValue({ value: [media], status: "hit" });
    const html = renderToStaticMarkup(await AniListSearchResults({ query: "薬屋", basePath: "/" }));
    expect(html).toContain("来自缓存");
    expect(html).toContain('data-media-id="anilist_123"');
    expect(mock.trending).not.toHaveBeenCalled();
    expect(mock.getTrending).not.toHaveBeenCalled();
  });

  it("contains AniList errors and keeps retries on the selected source", async () => {
    mock.search.mockRejectedValue(new Error("network unavailable"));
    const html = renderToStaticMarkup(await AniListSearchResults({ query: "薬屋", basePath: "/w/q" }));
    expect(html).toContain("AniList 暂时不可用");
    expect(html).toContain("source=anilist");
    expect(mock.getTrending).not.toHaveBeenCalled();
  });

  it("uses absolute AniList cover URLs and direct detail links in the anime wall", async () => {
    mock.trending.mockResolvedValue({ value: [media], status: "hit" });
    const html = renderToStaticMarkup(await TrendingRow({ activeKind: "anime", basePath: "/w/q", source: "anilist" }));
    expect(html).toContain('href="/anime/anilist/123?w=q"');
    expect(html).toContain('src="https://s4.anilist.co/file/anilistcdn/a.jpg"');
    expect(html).toContain("来自 AniList");
    expect(html).toContain("本季动画");
    expect(html).toContain("即将播出");
    expect(mock.getTrending).not.toHaveBeenCalled();
  });

  it("keeps movie discovery independent from AniList", async () => {
    mock.getTrending.mockResolvedValue([{ tmdbId: 123, title: "Movie", year: 2026, posterPath: "/a.jpg", mediaType: "movie" }]);
    const html = renderToStaticMarkup(await TrendingRow({ activeKind: "movie", basePath: "/" }));
    expect(html).toContain("来自 TMDB");
    expect(html).toContain("source=tmdb");
    expect(mock.trending).not.toHaveBeenCalled();
  });
});
