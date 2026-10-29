import { describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ tmdb: vi.fn(), anime: vi.fn(), settings: vi.fn((id: string) => ({ id })), proxy: vi.fn(async () => undefined) }));
vi.mock("@media-track/workflow", () => ({ fetchTmdbList: mocks.tmdb }));
vi.mock("./workflow-runtime", () => ({ getAccountScopedSettings: mocks.settings, getTmdbAccesses: async () => [{ baseURL: "https://tmdb.test" }] }));
vi.mock("./service-proxy", () => ({ getServiceProxyFetch: mocks.proxy }));
vi.mock("./anilist/config", () => ({ resolveAniListApiUrl: async () => "https://anilist.test" }));
vi.mock("./anilist/client", () => ({ AniListClient: class { search = mocks.anime; } }));
import { getMetadataHealth } from "./metadata-health";
describe("metadata health", () => {
  it("deduplicates per-account probes for 60 seconds and isolates failures without leaking errors", async () => {
    let time = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => time);
    mocks.tmdb.mockResolvedValue({}); mocks.anime.mockRejectedValue(new Error("secret details"));
    const [first, second] = await Promise.all([getMetadataHealth("account-a"), getMetadataHealth("account-a")]);
    expect(first).toEqual(second);
    expect(first).toMatchObject([{ service: "TMDB", ok: true }, { service: "AniList", ok: false }]);
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(mocks.tmdb).toHaveBeenCalledTimes(1);
    await getMetadataHealth("account-b"); expect(mocks.tmdb).toHaveBeenCalledTimes(2);
    expect(mocks.proxy).toHaveBeenCalledWith({ id: "account-a" }, "anilist");
    time += 60_001; await getMetadataHealth("account-a");
    expect(mocks.tmdb).toHaveBeenCalledTimes(3); clock.mockRestore();
  });
});
