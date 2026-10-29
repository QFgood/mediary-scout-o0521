import { createTmdbMetadataProvider, prepareTrackingTarget } from "@media-track/workflow";
import { adaptAniListTask, parseVerifiedMappings, type AniListTaskCompatibility } from "../metadata/task-adapter";
import type { AniListMetadata } from "./mapper";
import { prepareNativeAniListTarget } from "./native-target";

export type AniListAcquisitionTarget =
  | { supported: true; target: import("@media-track/workflow").PreparedTrackingTarget; mode: "native" | "mapped" }
  | { supported: false; reason: string };

/** Keep an explicitly configured mapping; otherwise acquire the independent AniList entry. */
export async function getAniListAcquisitionTarget(media: AniListMetadata, accountId?: string): Promise<AniListAcquisitionTarget> {
  try {
    const mappings = media.format === "MOVIE" ? [] : parseVerifiedMappings(process.env.MEDIA_TRACK_ANILIST_MAPPINGS);
    if (media.format !== "MOVIE" && mappings.some((mapping) => mapping.anilistId === media.anilistId)) {
      const mapped = await getAniListTaskCompatibility(media, accountId);
      return mapped.supported ? { supported: true, target: mapped.target, mode: "mapped" } : mapped;
    }
    const native = prepareNativeAniListTarget(media);
    return native.supported ? { ...native, mode: "native" } : native;
  } catch {
    return { supported: false, reason: "AniList 映射配置无效，请管理员检查后重试。" };
  }
}

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
