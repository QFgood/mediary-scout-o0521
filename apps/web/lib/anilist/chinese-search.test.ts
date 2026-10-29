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

  it("leaves native/Latin inputs, existing results, and explicit IDs untouched", async () => {
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

  it("deduplicates and limits aliases, rejects fuzzy unrelated results, and keeps successful probes", async () => {
    const search = vi.fn(async (name: string) => {
      if (name === "bad") throw new Error("unavailable");
      if (name === native || name === media.aliases[0]) return [media, { ...media, anilistId: 2, title: "Other", originalTitle: "Other", aliases: [] }];
      return [];
    });
    const view = await getAniListSearchView("艾莉同学", undefined, { search, details: vi.fn() }, async () => [native, native, media.aliases[0]!, "bad", "unused"]);
    expect(search).toHaveBeenCalledTimes(4);
    expect(search).not.toHaveBeenCalledWith("unused");
    expect(view.candidates).toEqual([media]);
    expect(view.nameLookupUnavailable).toBe(true);
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
