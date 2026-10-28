import { describe, expect, it, vi } from "vitest";
import { AniListClient } from "./client";
import { ANILIST_API_URL_SETTING_KEY, DEFAULT_ANILIST_API_URL, normalizeAniListApiUrl, resolveAniListApiUrl } from "./config";

describe("AniList endpoint configuration", () => {
  it("defaults to the public GraphQL API and preserves custom proxy paths", () => {
    expect(normalizeAniListApiUrl(" ")).toBe(DEFAULT_ANILIST_API_URL);
    expect(normalizeAniListApiUrl(" https://proxy.example.com/anilist/graphql?region=jp ")).toBe("https://proxy.example.com/anilist/graphql?region=jp");
    expect(normalizeAniListApiUrl("http://192.168.1.10:8080/graphql")).toBe("http://192.168.1.10:8080/graphql");
  });

  it("rejects malformed URLs, non-HTTP protocols, URL credentials and fragments", () => {
    for (const url of ["not a url", "file:///etc/hosts", "javascript:alert(1)", "https://user:pass@example.com/api", "https://example.com/graphql#fragment"]) {
      expect(() => normalizeAniListApiUrl(url)).toThrow();
    }
  });

  it("uses account setting, then deployment environment, then public default", async () => {
    const read = vi.fn(async () => "https://account.example/graphql");
    expect(await resolveAniListApiUrl({ getSetting: read }, { ANILIST_API_URL: "https://env.example/graphql" })).toBe("https://account.example/graphql");
    expect(read).toHaveBeenCalledWith(ANILIST_API_URL_SETTING_KEY);
    expect(await resolveAniListApiUrl({ getSetting: async () => " " }, { ANILIST_API_URL: "https://env.example/graphql" })).toBe("https://env.example/graphql");
    expect(await resolveAniListApiUrl({ getSetting: async () => null }, {})).toBe(DEFAULT_ANILIST_API_URL);
  });

  it("sends GraphQL requests to the configured endpoint without adding another path", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json({ data: { Page: { media: [] } } }));
    const client = new AniListClient({ endpoint: "https://proxy.example/anilist/graphql", fetch: transport });
    await client.search("动画");
    expect(transport).toHaveBeenCalledWith("https://proxy.example/anilist/graphql", expect.objectContaining({ method: "POST", cache: "no-store" }));
  });
});
