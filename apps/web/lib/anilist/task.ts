import { createTmdbMetadataProvider, prepareTrackingTarget } from "@media-track/workflow";
import { adaptAniListTask, parseVerifiedMappings, type AniListTaskCompatibility } from "../metadata/task-adapter";
import type { AniListMetadata } from "./mapper";

/** The dynamic import avoids introducing a workflow-runtime import cycle. */
export async function getAniListTaskCompatibility(media: AniListMetadata, accountId?: string): Promise<AniListTaskCompatibility> {
  try {
    const mappings = parseVerifiedMappings(process.env.MEDIA_TRACK_ANILIST_MAPPINGS);
    return await adaptAniListTask({ media, mappings, prepareTarget: async (mapping) => {
      if (process.env.MEDIA_TRACK_SEARCH_PROVIDER !== "tmdb") throw new Error("AniList 获取需要启用真实 TMDB 元数据服务。");
      const runtime = await import("../workflow-runtime");
      const settings = runtime.getAccountScopedSettings(accountId ?? await runtime.getCurrentAccountId());
      return prepareTrackingTarget({
        tmdbId: mapping.tmdbId, mediaType: "tv", seasonNumber: mapping.seasonNumber,
        qualityPreference: "4K",
        metadataProvider: createTmdbMetadataProvider(await runtime.getTmdbAccesses(settings)),
      });
    } });
  } catch {
    return { supported: false, reason: "暂时无法验证 AniList 季度映射，请检查映射配置及元数据服务后重试。" };
  }
}
