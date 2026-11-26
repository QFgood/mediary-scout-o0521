import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { agentApiGuard } from "../../../../lib/agent-api/guard";
import { getOwnerAccountId } from "../../../../lib/agent-api/owner";
import { getAgentMediaSearchProvider } from "../../../../lib/agent-api/search";
import { GET } from "./route";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, connection: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("../../../../lib/agent-api/guard", () => ({ agentApiGuard: vi.fn() }));
vi.mock("../../../../lib/agent-api/owner", () => ({ getOwnerAccountId: vi.fn() }));
vi.mock("../../../../lib/agent-api/search", () => ({ getAgentMediaSearchProvider: vi.fn() }));

describe("GET /api/agent/search", () => {
  const searchMedia = vi.fn();
  const request = (params: Record<string, string>) =>
    new NextRequest("https://scout.example/api/agent/search?" + new URLSearchParams(params));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentApiGuard).mockResolvedValue(null);
    vi.mocked(getOwnerAccountId).mockResolvedValue("owner");
    vi.mocked(getAgentMediaSearchProvider).mockResolvedValue({ searchMedia });
  });

  it("requires the agent token before looking up an account or provider", async () => {
    vi.mocked(agentApiGuard).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const response = await GET(request({ query: "Test" }));
    expect(response.status).toBe(401);
    expect(getOwnerAccountId).not.toHaveBeenCalled();
    expect(searchMedia).not.toHaveBeenCalled();
  });

  it("returns even a single matching title with its identity and seasons", async () => {
    searchMedia.mockResolvedValue([
      { tmdbId: 1, title: "Same title", originalTitle: "Film", mediaType: "movie", year: 2024, overview: "", seasons: [] },
      { tmdbId: 2, title: "Same title", originalTitle: "Series", mediaType: "tv", year: 2025, overview: "Synopsis",
        seasons: [{ seasonNumber: 2 }, { seasonNumber: 1 }, { seasonNumber: 2 }] },
    ]);
    const response = await GET(request({ query: "  Same title  ", type: "tv" }));
    expect(response.status).toBe(200);
    expect(getAgentMediaSearchProvider).toHaveBeenCalledWith("owner");
    expect(searchMedia).toHaveBeenCalledWith({ query: "Same title" });
    expect(await response.json()).toEqual({ items: [
      { tmdbId: 2, title: "Same title", originalTitle: "Series", type: "tv", year: 2025, overview: "Synopsis",
        seasonNumbers: [1, 2] },
    ] });
  });

  it("returns an empty list for a miss and rejects invalid type", async () => {
    searchMedia.mockResolvedValue([]);
    const empty = await GET(request({ query: "No match" }));
    expect(await empty.json()).toEqual({ items: [] });
    const invalid = await GET(request({ query: "Test", type: "person" }));
    expect(invalid.status).toBe(400);
    expect(searchMedia).toHaveBeenCalledTimes(1);
  });
});
