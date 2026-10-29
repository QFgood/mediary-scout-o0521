import { MockLanguageModelV3 } from "ai/test";
import { describe, it, expect } from "vitest";
import { InMemoryWorkflowRepository, FakeStorageExecutor, FakeResourceProvider, runScheduledType3Monitoring } from "@media-track/workflow";
import { prepareNativeAniListTarget } from "./native-target";
import { reserveAniListSeries } from "./reservation";
import type { AniListMetadata } from "./mapper";
const media: AniListMetadata = { source: "anilist", anilistId: 777, title: "Series 2", originalTitle: "Series 2", aliases: [], mediaType: "anime", year: 2027, episodeCount: null, status: "NOT_YET_RELEASED", format: "TV", posterUrl: null, overview: "" };
const scope = { accountId: "acct_default", connectedStorageId: "drive" };
describe("upcoming anime reservations", () => {
  it("reserves unknown counts without fake episodes or queued work and is idempotent", async () => {
    const repo = new InMemoryWorkflowRepository();
    const result = prepareNativeAniListTarget(media);
    expect(result.supported).toBe(true); if (!result.supported) return;
    expect(result.target.season.totalEpisodes).toBe(0);
    expect(await reserveAniListSeries(result.target, repo, scope)).toMatchObject({ status: "reserved" });
    expect(await reserveAniListSeries(result.target, repo, scope)).toMatchObject({ status: "already_tracked" });
    const state = await repo.getTrackedSeasonState(result.target.season.id, scope);
    expect(state?.episodes).toEqual([]);
    expect(await repo.claimNextQueuedWorkflowRun({ kind: "type2_init", now: new Date().toISOString() })).toBeNull();
    expect(await repo.listTrackedSeasonStates({ ...scope, accountId: "other" })).toEqual([]);
  });
  it("refreshes an empty reservation before patrol and starts only after aired episodes are known", async () => {
    const repo = new InMemoryWorkflowRepository(); const result = prepareNativeAniListTarget(media); if (!result.supported) throw new Error(result.reason);
    await reserveAniListSeries(result.target, repo, scope);
    let step = 0;
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const model = new MockLanguageModelV3({ doGenerate: async () => {
      step++;
      if (step > 2) return { content: [{ type: "text", text: "done" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
      return { content: [{ type: "tool-call", toolCallId: `call-${step}`, toolName: step === 1 ? "searchResources" : "reportNoCoverage", input: JSON.stringify(step === 1 ? { keyword: "Series 2" } : { reason: "fixture has no sources" }) }], finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage, warnings: [] };
    } });
    const deps = { repository: repo, resourceProvider: new FakeResourceProvider({ keywordResults: {} }), storage: new FakeStorageExecutor(), model, storageParentDirectoryId: "root" };
    let reads = 0;
    expect(await runScheduledType3Monitoring({ ...deps, syncSeasonMetadata: async () => { reads++; return { totalEpisodes: 0, latestAiredEpisode: 0 }; } })).toEqual([]);
    expect(reads).toBe(1);
    const outcomes = await runScheduledType3Monitoring({ ...deps, syncSeasonMetadata: async () => ({ totalEpisodes: 12, latestAiredEpisode: 1, title: { ...result.target.title, anilistStatus: "RELEASING" } }) });
    expect(outcomes).toHaveLength(1);
    expect((await repo.getTrackedSeasonState(result.target.season.id, scope))?.season.totalEpisodes).toBe(12);
  }, 30000);
  it("still rejects unknown counts after release and cancelled works", () => {
    expect(prepareNativeAniListTarget({ ...media, status: "RELEASING" }).supported).toBe(false);
    expect(prepareNativeAniListTarget({ ...media, status: "CANCELLED" }).supported).toBe(false);
  });
});
