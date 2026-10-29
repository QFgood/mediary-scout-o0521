import { describe, expect, it, vi } from "vitest";
import { getAniListSearchView } from "./search";
import { lookupAniListOriginalNames } from "./name-lookup";
import type { AniListMetadata } from "./mapper";

const mocks = vi.hoisted(() => ({ searchMedia: vi.fn(), accesses: vi.fn(), createProvider: vi.fn() }));
vi.mock("@media-track/workflow", () => ({ createTmdbSearchProvider: mocks.createProvider }));
vi.mock("../workflow-runtime", () => ({
  getCurrentAccountId: async () => "account-a",
  getAccountScopedSettings: (id: string) => ({ accountId: id }),
  getTmdbAccesses: mocks.accesses,
}));

const native = "時々ボソッとロシア語でデレる隣のアーリャさん";
const media: AniListMetadata = { source: "anilist", anilistId: 154593, title: native, originalTitle: native,
  aliases: ["Alya Sometimes Hides Her Feelings in Russian"], mediaType: "anime", year: 2024,
  posterUrl: null, overview: "", episodeCount: 12 };

describe("AniList localized name search", () => {
  it("looks up the Chinese name, searches its original, and preserves AniList identity", async () => {
    const search = vi.fn(async (query: string) => query === native ? [media] : []);
    const lookup = vi.fn(async () => [native]);
    const view = await getAniListSearchView(" 艾莉同学 ", undefined, { search, details: vi.fn() }, lookup);
    expect(lookup).toHaveBeenCalledWith("艾莉同学");
    expect(search.mock.calls.map(([query]) => query)).toEqual(["艾莉同学", native]);
    expect(view).toMatchObject({ query: "艾莉同学", state: "ready", candidates: [media], resolvedQueries: [native] });
    expect(view.candidates[0]).not.toHaveProperty("tmdbId");
  });

  it("leaves native/Latin inputs and explicit IDs untouched, without TMDB calls for existing matches", async () => {
    const lookup = vi.fn();
    for (const query of [native, "Alya", "ロシア語 中文"]) {
      await getAniListSearchView(query, undefined, { search: async () => [], details: vi.fn() }, lookup);
    }
    await getAniListSearchView("艾莉同学", undefined, { search: async () => [media], details: vi.fn() }, lookup);
    const search = vi.fn();
    await getAniListSearchView("艾莉同学", "154593", { search, details: async () => media }, lookup);
    expect(lookup).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });

  it("deduplicates and limits aliases, preserves native results, and keeps successful probes", async () => {
    const search = vi.fn(async (name: string) => {
      if (name === "bad") throw new Error("unavailable");
      if (name === native || name === media.aliases[0]) return [media, { ...media, anilistId: 2, title: "Other", originalTitle: "Other", aliases: [] }];
      return [];
    });
    const view = await getAniListSearchView("艾莉同学", undefined, { search, details: vi.fn() }, async () => [native, native, media.aliases[0]!, "bad", "unused"]);
    expect(search).toHaveBeenCalledTimes(4);
    expect(search).not.toHaveBeenCalledWith("unused");
    expect(view.candidates.map((item) => item.anilistId)).toEqual([media.anilistId, 2]);
    expect(view.nameLookupUnavailable).toBe(true);
  });

  it.each([true, false])("returns the same nine native-query results when Chinese initially matches season 1: %s", async (hasChineseMatch) => {
    const name = "薬屋のひとりごと";
    const first = { ...media, anilistId: 161645, title: name, originalTitle: name, aliases: ["药屋少女的呢喃"] };
    const nativeResults = [first, ...Array.from({ length: 8 }, (_, index) => ({ ...first, anilistId: 200000 + index,
      title: index === 0 ? "猫猫のひとりごと" : `${name} 第${index + 2}期`,
      originalTitle: index === 0 ? "猫猫のひとりごと" : `${name} 第${index + 2}期`, aliases: [] }))];
    const search = vi.fn(async (query: string) => query === name ? nativeResults : hasChineseMatch ? [first] : []);
    const lookup = vi.fn(async () => [name]);
    const chinese = await getAniListSearchView("药屋少女的呢喃", undefined, { search, details: vi.fn() }, lookup);
    const japanese = await getAniListSearchView(name, undefined, { search, details: vi.fn() }, lookup);
    expect(chinese.candidates).toEqual(japanese.candidates);
    expect(chinese.candidates).toHaveLength(9);
    expect(chinese.resolvedQueries).toEqual([name]);
    expect(chinese.query).toBe("药屋少女的呢喃");
    expect(lookup).toHaveBeenCalledTimes(hasChineseMatch ? 0 : 1);
    expect(chinese.candidates.every((item) => item.source === "anilist" && !("tmdbId" in item))).toBe(true);
  });

  it("keeps direct Chinese matches when the native search fails, and does not call TMDB", async () => {
    const search = vi.fn(async (query: string) => { if (query === native) throw new Error("rate limit"); return [media]; });
    const lookup = vi.fn();
    expect(await getAniListSearchView("中文", undefined, { search, details: vi.fn() }, lookup))
      .toMatchObject({ state: "ready", candidates: [media], nameLookupUnavailable: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects unanchored TMDB search names instead of displaying unrelated matches", async () => {
    const search = vi.fn(async (query: string) => query === "中文" ? [] : [media]);
    expect((await getAniListSearchView("中文", undefined, { search, details: vi.fn() }, async () => ["Unrelated Work"])).candidates).toEqual([]);
  });

  it("matches harmless spacing and punctuation differences", async () => {
    const view = await getAniListSearchView("中文", undefined, { search: async (q) => q === "中文" ? [] : [media], details: vi.fn() }, async () => ["Alya: Sometimes Hides Her Feelings in Russian"]);
    expect(view.candidates).toEqual([media]);
  });

  it("keeps auxiliary outages separate from primary AniList errors and handles unknown names", async () => {
    const client = { search: async () => [], details: vi.fn() };
    expect(await getAniListSearchView("未知中文", undefined, client, async () => [])).toMatchObject({ state: "ready", candidates: [] });
    expect(await getAniListSearchView("中文", undefined, client, async () => { throw new Error("TMDB down"); })).toMatchObject({ state: "ready", candidates: [], nameLookupUnavailable: true });
    const lookup = vi.fn();
    expect(await getAniListSearchView("中文", undefined, { ...client, search: async () => { throw new Error("AniList down"); } }, lookup)).toMatchObject({ state: "provider_error" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("uses account-scoped TMDB accesses without unnecessary TV metadata calls", async () => {
    mocks.accesses.mockResolvedValue([{ baseURL: "https://example.test" }]);
    mocks.createProvider.mockReturnValue({ searchMedia: mocks.searchMedia });
    mocks.searchMedia.mockResolvedValue([{ originalTitle: native }, { originalTitle: native }, { originalTitle: "中文" }, { originalTitle: "" }]);
    expect(await lookupAniListOriginalNames("中文")).toEqual([native]);
    expect(mocks.accesses).toHaveBeenCalledWith({ accountId: "account-a" });
    expect(mocks.createProvider).toHaveBeenCalledWith([{ baseURL: "https://example.test" }], { tvDetailsLimit: 0 });
    expect(mocks.searchMedia).toHaveBeenCalledWith({ query: "中文" });
  });

});
