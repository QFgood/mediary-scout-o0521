import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executor: vi.fn(), search: vi.fn(),
  children: vi.fn(async (id: string) => id === "movies" ? [{ id: "film", name: "Film (2025) {tmdb-10}" }] : []),
  tree: vi.fn(async () => [{ path: "Film.mp4", providerFileId: "file-1", sizeBytes: 1000 }]),
}));
vi.mock("@media-track/workflow", async (original) => {
  const actual = await original<typeof import("@media-track/workflow")>();
  return { ...actual, createExecutorForBrand: (input: unknown) => { mocks.executor(input); return { listChildDirectories: mocks.children, listTree: mocks.tree }; },
    createTmdbMetadataProvider: () => ({ getMovieDetails: async () => ({ id: 10, title: "Film", original_title: "Film", release_date: "2025-01-01", production_countries: [], origin_country: [], genres: [], poster_path: null, backdrop_path: null, overview: "" }) }),
    createTmdbSearchProvider: () => ({ searchMedia: mocks.search }),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let rt: typeof import("./workflow-runtime");
beforeEach(async () => {
  vi.stubEnv("MEDIA_TRACK_SQLITE_PATH", ":memory:"); vi.stubEnv("MEDIA_TRACK_POSTGRES_URL", "");
  vi.stubEnv("MEDIA_TRACK_MULTI_USER", "0"); vi.stubEnv("MEDIA_TRACK_STORAGE_ADAPTER", "115"); vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "0");
  vi.resetModules(); mocks.executor.mockClear(); mocks.search.mockReset(); mocks.children.mockClear(); mocks.tree.mockClear();
  mocks.children.mockImplementation(async (id) => id === "movies" ? [{ id: "film", name: "Film (2025) {tmdb-10}" }] : []);
  rt = await import("./workflow-runtime");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
async function bind(accountId = "acct_default", id = "drive-a") {
  await rt.getWorkflowRepository().upsertConnectedStorage({ id, accountId, provider: "quark", providerUid: id, label: "test", payload: { cookie: "dummy" }, rootCid: "root", moviesCid: "movies", tvCid: "tv", animeCid: "anime", createdAt: "2026-01-01T00:00:00Z" });
}
describe("library sync runtime boundaries", () => {
  it("refuses an unbound drive and does not use any legacy environment credential", async () => {
    await expect(rt.syncCurrentDriveLibrary()).rejects.toThrow("绑定");
    expect(mocks.executor).not.toHaveBeenCalled();
  });
  it("does not scan another account's drive", async () => {
    await bind("acct_other", "foreign");
    await expect(rt.syncCurrentDriveLibrary("foreign")).rejects.toThrow();
    expect(mocks.executor).not.toHaveBeenCalled();
  });
  it("restores records on the selected drive using that drive's scoped credentials", async () => {
    await bind();
    expect(await rt.syncCurrentDriveLibrary("drive-a")).toMatchObject({ imported: 1, episodes: 1, issues: [] });
    expect(mocks.executor).toHaveBeenCalledWith(expect.objectContaining({ provider: "quark", cookie: "dummy", scopeCids: ["root", "movies", "tv", "anime"] }));
    expect(await rt.getWorkflowRepository().listTrackedSeasonStates({ accountId: "acct_default", connectedStorageId: "drive-a" })).toHaveLength(1);
    expect(await rt.syncCurrentDriveLibrary("drive-a")).toMatchObject({ imported: 0, existing: 1 });
  });
  it("accepts only unique exact title/year matches for legacy directories", async () => {
    await bind(); mocks.children.mockImplementation(async (id) => id === "movies" ? [{ id: "film", name: "Film (2025)" }] : []);
    mocks.search.mockResolvedValue([{ tmdbId: 10, mediaType: "movie", title: "Film", originalTitle: "Film", year: 2025 }]);
    expect((await rt.syncCurrentDriveLibrary("drive-a")).imported).toBe(1);
  });
  it("reports ambiguous legacy matches without creating a record", async () => {
    await bind(); mocks.children.mockImplementation(async (id) => id === "movies" ? [{ id: "film", name: "Film (2025)" }] : []);
    mocks.search.mockResolvedValue([10, 11].map((tmdbId) => ({ tmdbId, mediaType: "movie", title: "Film", originalTitle: "Film", year: 2025 })));
    const result = await rt.syncCurrentDriveLibrary("drive-a");
    expect(result.imported).toBe(0); expect(result.issues).toHaveLength(1);
  });
  it("rejects the action in demo mode", async () => {
    vi.stubEnv("MEDIA_TRACK_DEMO_MODE", "1");
    const { syncDriveLibraryAction } = await import("../app/actions");
    await expect(syncDriveLibraryAction("drive-a")).rejects.toThrow("只读");
    expect(mocks.executor).not.toHaveBeenCalled();
  });
});
