import type { AssrtProviderPort } from "../subtitle-provider.js";
import type { AgentMemoryStore } from "../agent-memory.js";
import type { LanguageModel } from "ai";
import type { MediaTitle } from "../domain.js";
import type { ResourceProvider, StorageExecutor } from "../ports.js";
import {
  bridgeV2WorkflowToResult,
  type BridgedV2Result,
  type V2BridgeMode,
  type V2BridgeSeasonIntent,
} from "./workflow-v2-bridge.js";
import type { DeadLinkStore } from "./dead-links.js";
import type { JevJudge } from "../jev-judge.js";
import { runAcquisitionV2Workflow, type RunAcquisitionV2WorkflowRequest } from "./workflow-v2.js";
import { getQualityGuidance, getSearchRecipe, searchProfile } from "./search-profile.js";
import type { AgentToolEvent } from "./activity.js";

function defaultNowIso(): string {
  return new Date().toISOString();
}

/**
 * Phase 7d — the single TV/anime acquisition entry on the V2 engine. type2 init,
 * series init, and type3 patrol are all the SAME resource-sync workflow
 * (verify-or-create dirs → sync need → strong agent → reconcile); they differ
 * only in the notification framing, captured by `mode`. Returns the bridged
 * per-season WorkflowResult facts; persistence is the runner's job.
 */
export interface RunTvAcquisitionV2Request {
  title: MediaTitle;
  mode: V2BridgeMode;
  seasons: V2BridgeSeasonIntent[];
  /** Library category parent (Movies/TV/Anime), chosen by title.type upstream. */
  categoryParentId: string;
  resourceProvider: ResourceProvider;
  storage: StorageExecutor;
  model: LanguageModel;
  workflowRunId: string;
  /** 实有 = the DB obtained marks (agent's prior markObtained); empty for a first
   *  acquisition, the type-3 patrol passes the DB obtained codes. */
  priorObtained?: string[];
  searchBudget?: number;
  maxSteps?: number;
  preferredLanguage?: string;
  /** Global quality preference ("high"/"medium"); undefined = 不限 (no guidance). */
  qualityPreference?: "high" | "medium";
  /** The run's drive brand ("pan115" | "quark") — selects brand-specific skill. */
  storageProvider?: string;
  /** assrt token (Settings → 字幕来源). Undefined = 字幕流程不触发。 */
  assrtToken?: string;
  assrtProvider?: AssrtProviderPort;
  /** Optional Jev candidate prefilter (Settings); resolved per account by the worker. */
  jevJudge?: JevJudge;
  deadLinkStore?: DeadLinkStore;
  /** Agent memory (see orchestrator.memory). */
  memory?: { store: AgentMemoryStore; accountId: string; drive?: string };
  /** A replace_request run (see orchestrator.userRequest). */
  userRequest?: RunAcquisitionV2WorkflowRequest["userRequest"];
  /** See orchestrator.protectExisting. */
  protectExisting?: RunAcquisitionV2WorkflowRequest["protectExisting"];
  /** See orchestrator.rejectedLookup. */
  rejectedLookup?: RunAcquisitionV2WorkflowRequest["rejectedLookup"];
  /** See orchestrator.linkHistory. */
  linkHistory?: RunAcquisitionV2WorkflowRequest["linkHistory"];
  /** Leftover staging dir adopted as this run's staging. See workflow-v2. */
  stagingRecovery?: RunAcquisitionV2WorkflowRequest["stagingRecovery"];
  onProgress?: (event: AgentToolEvent) => void;
  now?: () => string;
}

export async function runTvAcquisitionV2(request: RunTvAcquisitionV2Request): Promise<BridgedV2Result> {
  if (request.seasons.length === 0) {
    throw new Error("runTvAcquisitionV2 requires at least one season in scope");
  }
  // The fine-grained profile drives BOTH the keyword recipe and the quality
  // guidance (e.g. anime → "4K is scarce, don't over-search for it").
  const profile = searchProfile({
    type: request.title.type,
    originCountries: request.title.originCountries ?? [],
  });
  const qualityGuidance = getQualityGuidance(profile, request.qualityPreference);
  const v2 = await runAcquisitionV2Workflow({
    provider: request.resourceProvider,
    executor: request.storage,
    model: request.model,
    workflowRunId: request.workflowRunId,
    title: {
      name: request.title.title,
      year: request.title.year ?? 0,
      aliases: request.title.aliases ?? [],
      tmdbId: request.title.tmdbId,
      ...(request.title.anilistId === undefined ? {} : { anilistId: request.title.anilistId }),
    },
    categoryParentId: request.categoryParentId,
    seasons: request.seasons.map((season) => ({
      seasonNumber: season.seasonNumber,
      latestAiredEpisode: season.latestAiredEpisode,
    })),
    qualityPreference: request.seasons[0]!.qualityPreference,
    searchHints: getSearchRecipe(profile) + (request.title.source === "anilist" ?
      `\n目标是 AniList 独立动画条目（ID ${request.title.anilistId}）：${request.title.title}。保留完整标题里的续作/篇章信息；内部 S01 仅代表此条目的相对集号分组，不代表整个系列第一季。仅匹配本条目范围内的相对集号，不把同系列其他季或连续总集号自动映射进来。资源仅有连续总集号且对应关系不明时不要转存。` : ""),
    searchProfile: profile,
    ...(qualityGuidance === "" ? {} : { qualityGuidance }),
    ...(request.priorObtained === undefined ? {} : { priorObtained: request.priorObtained }),
    ...(request.searchBudget === undefined ? {} : { searchBudget: request.searchBudget }),
    ...(request.maxSteps === undefined ? {} : { maxSteps: request.maxSteps }),
    ...(request.preferredLanguage === undefined ? {} : { preferredLanguage: request.preferredLanguage }),
    ...(request.title.originCountries === undefined ? {} : { originCountries: request.title.originCountries }),
    ...(request.storageProvider === undefined ? {} : { storageProvider: request.storageProvider }),
    ...(request.assrtToken === undefined ? {} : { assrtToken: request.assrtToken }),
    ...(request.assrtProvider === undefined ? {} : { assrtProvider: request.assrtProvider }),
    ...(request.jevJudge === undefined ? {} : { jevJudge: request.jevJudge }),
    ...(request.deadLinkStore ? { deadLinkStore: request.deadLinkStore } : {}),
    ...(request.memory ? { memory: request.memory } : {}),
    ...(request.userRequest ? { userRequest: request.userRequest } : {}),
    ...(request.protectExisting ? { protectExisting: request.protectExisting } : {}),
    ...(request.rejectedLookup ? { rejectedLookup: request.rejectedLookup } : {}),
    ...(request.linkHistory ? { linkHistory: request.linkHistory } : {}),
    ...(request.stagingRecovery ? { stagingRecovery: request.stagingRecovery } : {}),
    ...(request.onProgress ? { onProgress: request.onProgress } : {}),
  });

  const bridged = bridgeV2WorkflowToResult({
    title: request.title,
    mode: request.stagingRecovery ? "staging_recovery" : request.mode,
    seasons: request.seasons,
    v2,
    workflowRunId: request.workflowRunId,
    now: request.now ?? defaultNowIso,
  });
  return v2.replacement ? { ...bridged, replacement: v2.replacement } : bridged;
}
