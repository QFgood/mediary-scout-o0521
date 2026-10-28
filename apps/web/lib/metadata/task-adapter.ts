import type { MediaIdentity } from "./types";

export const ANILIST_TASK_UNSUPPORTED =
  "此 AniList 条目尚无经过验证的季度与集数映射，暂不能提交获取。可切换到 TMDB 查找并确认目标；不会自动把续作映射为第一季。";

export type MetadataTaskDecision =
  | { supported: true; candidateId: string; identity: MediaIdentity }
  | { supported: false; reason: string };

/** This boundary deliberately refuses unverified cross-provider mappings. */
export function adaptMetadataTask(
  identity: MediaIdentity,
  target: { mediaType: "movie" | "tv" | "anime"; seasonNumber?: number },
): MetadataTaskDecision {
  if (identity.source === "anilist") {
    return { supported: false, reason: ANILIST_TASK_UNSUPPORTED };
  }
  if (!Number.isSafeInteger(identity.tmdbId) || identity.tmdbId <= 0) {
    return { supported: false, reason: "作品编号无效。" };
  }
  if (target.mediaType === "movie") {
    return { supported: true, identity, candidateId: `tmdb_movie_${identity.tmdbId}` };
  }
  const season = target.seasonNumber;
  if (!Number.isSafeInteger(season) || season === undefined || season <= 0) {
    return { supported: false, reason: "请明确选择有效的季度。" };
  }
  return { supported: true, identity, candidateId: `tmdb_tv_${identity.tmdbId}_s${season}` };
}
