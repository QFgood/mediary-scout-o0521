import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const settings = new Map<string, string>();
  return {
    settings,
    account: vi.fn(async () => "acct-a"),
    current: vi.fn(async () => "acct-a"),
    write: vi.fn(async (accountId: string, key: string, value: string) => { settings.set(`${accountId}:${key}`, value); }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../workflow-runtime", () => ({
  queueCandidateSeries: vi.fn(), queueCandidateTracking: vi.fn(), reserveCandidate: vi.fn(),
  requireAuthenticatedAccountId: mocks.account, getCurrentAccountId: mocks.current,
  getWorkflowRepository: () => ({ setAccountSetting: mocks.write }),
  getAccountScopedSettings: (accountId: string) => ({ getSetting: async (key: string) => mocks.settings.get(`${accountId}:${key}`) ?? null }),
}));

import { saveAniListApiUrlAction } from "../../app/actions";
import { getAniListClient } from "./server-client";
import { anilistClient } from "./client";
import { ANILIST_API_URL_SETTING_KEY, DEFAULT_ANILIST_API_URL } from "./config";

beforeEach(() => {
  mocks.settings.clear(); mocks.write.mockClear(); mocks.current.mockClear(); mocks.account.mockResolvedValue("acct-a");
  vi.stubEnv("ANILIST_API_URL", ""); vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "0");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("account-scoped AniList settings", () => {
  it("persists only to the authenticated account and restores the deployment default", async () => {
    expect(await saveAniListApiUrlAction(" https://a.example/graphql ")).toEqual({ success: true, apiUrl: "https://a.example/graphql" });
    expect(mocks.write).toHaveBeenCalledWith("acct-a", ANILIST_API_URL_SETTING_KEY, "https://a.example/graphql");
    expect(mocks.settings.get(`acct-b:${ANILIST_API_URL_SETTING_KEY}`)).toBeUndefined();
    vi.stubEnv("ANILIST_API_URL", "https://deployment.example/graphql");
    expect(await saveAniListApiUrlAction("")).toEqual({ success: true, apiUrl: "https://deployment.example/graphql" });
    expect(mocks.settings.get(`acct-a:${ANILIST_API_URL_SETTING_KEY}`)).toBe("");
  });

  it("rejects invalid addresses, unauthenticated writes and demo mode", async () => {
    expect(await saveAniListApiUrlAction("file:///tmp/not-api")).toMatchObject({ success: false });
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.account.mockRejectedValueOnce(new Error("未登录"));
    expect(await saveAniListApiUrlAction("https://a.example/graphql")).toEqual({ success: false, message: "未登录" });
    expect(mocks.write).not.toHaveBeenCalled();
    vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "1");
    await expect(saveAniListApiUrlAction("https://a.example/graphql")).rejects.toThrow("只读");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not clear a working override when the deployment fallback is invalid", async () => {
    await saveAniListApiUrlAction("https://working.example/graphql");
    vi.stubEnv("ANILIST_API_URL", "bad-url");
    expect(await saveAniListApiUrlAction("")).toMatchObject({ success: false });
    expect(mocks.settings.get(`acct-a:${ANILIST_API_URL_SETTING_KEY}`)).toBe("https://working.example/graphql");
  });

  it("resolves a background worker's owner instead of the current browser account", async () => {
    mocks.settings.set(`worker-owner:${ANILIST_API_URL_SETTING_KEY}`, "https://worker.example/graphql");
    const worker = await getAniListClient("worker-owner");
    expect(worker).not.toBe(await getAniListClient("acct-a"));
    expect(mocks.current).not.toHaveBeenCalled();
    expect(await getAniListClient("acct-a")).toBe(anilistClient);
  });

  it("uses the endpoint for search, details and feeds, and separates caches after changing endpoints", async () => {
    const raw = { id: 1, type: "ANIME", isAdult: false, countryOfOrigin: "JP", title: { native: "动画", romaji: null, english: null },
      synonyms: [], description: "", coverImage: null, startDate: { year: 2026 }, seasonYear: 2026, season: "FALL", episodes: 25, format: "TV", status: "RELEASING", popularity: 1 };
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: { Page: { media: [raw] }, Media: raw } }));
    vi.stubGlobal("fetch", transport);
    await saveAniListApiUrlAction("https://first-endpoint.example/graphql");
    const first = await getAniListClient("acct-a");
    await first.search("same-query"); await first.details(1); await first.trending("season");
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.every(([url]) => url === "https://first-endpoint.example/graphql")).toBe(true);
    await saveAniListApiUrlAction("https://second-endpoint.example/graphql");
    const second = await getAniListClient("acct-a");
    expect(second).not.toBe(first);
    await second.search("same-query");
    expect(transport.mock.calls.at(-1)?.[0]).toBe("https://second-endpoint.example/graphql");
    expect(transport).toHaveBeenCalledTimes(4);
    expect((await saveAniListApiUrlAction("")).apiUrl).toBe(DEFAULT_ANILIST_API_URL);
    expect(await getAniListClient("acct-a")).toBe(anilistClient);
  });
});
