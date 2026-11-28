import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueCandidateTracking, reserveCandidate } from "../workflow-runtime";
import { acquireMedia } from "./acquire";

vi.mock("../workflow-runtime", () => ({
  queueCandidateTracking: vi.fn(),
  reserveCandidate: vi.fn(),
}));
vi.mock("./search", () => ({ getAgentMediaSearchProvider: vi.fn() }));

describe("Agent acquire", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the chosen AniList ID in the authenticated owner's workspace", async () => {
    vi.mocked(queueCandidateTracking).mockResolvedValue({
      status: "queued", workflowRunId: "run", trackedSeasonId: "season",
    });
    expect(await acquireMedia({ anilistId: 42, storageId: "drive" }, "owner")).toMatchObject({
      status: "requested", workflowRunId: "run",
    });
    expect(queueCandidateTracking).toHaveBeenCalledWith("anilist_anime_42", "drive", "owner");
    expect(reserveCandidate).not.toHaveBeenCalled();
  });

  it("reserves an unreleased AniList title without starting a workflow", async () => {
    vi.mocked(reserveCandidate).mockResolvedValue({ status: "reserved", trackedSeasonId: "season" });
    expect(await acquireMedia({ anilistId: 42, reserve: true }, "owner")).toMatchObject({ status: "reserved" });
    expect(reserveCandidate).toHaveBeenCalledWith("anilist_anime_42", undefined, "owner");
    expect(queueCandidateTracking).not.toHaveBeenCalled();
  });

  it("keeps the selected TMDB season and matching response", async () => {
    vi.mocked(queueCandidateTracking).mockResolvedValue({ status: "already_tracked", workflowRunId: null, trackedSeasonId: "season" });
    expect(await acquireMedia({ tmdbId: 42, type: "tv", season: 2 }, "owner")).toMatchObject({
      status: "already_tracked", matched: { tmdbId: 42, type: "tv" },
    });
    expect(queueCandidateTracking).toHaveBeenCalledWith("tmdb_tv_42_s2", undefined, "owner");
  });
});
