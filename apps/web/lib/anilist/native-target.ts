import type { PreparedTrackingTarget } from "@media-track/workflow";
import type { AniListMetadata } from "./mapper";

export type NativeAniListTarget =
  | { supported: true; target: PreparedTrackingTarget }
  | { supported: false; reason: string };

/** Each AniList entry owns its episode range; S01 is an internal group, never a series mapping. */
export function prepareNativeAniListTarget(media: AniListMetadata, now = Date.now()): NativeAniListTarget {
  if (!["TV", "TV_SHORT", "ONA", "OVA"].includes(media.format ?? "")) {
    return { supported: false, reason: "此类型暂不支持动画条目获取。" };
  }
  if (!Number.isSafeInteger(media.anilistId) || media.anilistId <= 0 || media.anilistId > 2_147_483_647 || !media.title.trim()) {
    return { supported: false, reason: "AniList 作品标识或标题无效。" };
  }
  const count = media.episodeCount;
  if (!count || !Number.isSafeInteger(count) || count > 2000) {
    return { supported: false, reason: "AniList 尚未提供有效的条目总集数，暂无法确定获取范围。" };
  }
  if (media.status === "CANCELLED") return { supported: false, reason: "该动画已取消播出，暂不提交获取。" };
  const aired = (media.airingEpisodes ?? []).filter((episode) => episode.airingAt * 1000 <= now).map((episode) => episode.episode);
  let latest = media.status === "FINISHED" ? count : Math.max(0, ...aired);
  if (media.nextAiringEpisode) {
    // A cached 'next' episode may now be airing: do not count it as aired without a fresh schedule.
    latest = Math.max(latest, media.nextAiringEpisode.episode - 1);
  }
  if (latest > count) return { supported: false, reason: "AniList 播出集号超出条目总集数，无法确认相对集号，请稍后重试。" };
  if (media.status === "NOT_YET_RELEASED") latest = 0;
  const knownSchedule = media.status === "FINISHED" || media.status === "NOT_YET_RELEASED" || media.nextAiringEpisode != null || aired.length > 0;
  const id = `anilist_anime_${media.anilistId}`;
  return { supported: true, target: {
    title: {
      id, source: "anilist", anilistId: media.anilistId, tmdbId: null, type: "anime",
      episodeNumbering: "entry_relative", title: media.title, originalTitle: media.originalTitle,
      aliases: media.aliases, year: media.year ?? 0, originCountries: ["JP"],
      posterPath: media.posterUrl, backdropPath: null, overview: media.overview,
    },
    season: {
      id: `${id}_s1`, mediaTitleId: id, seasonNumber: 1, status: "active", qualityPreference: "4K",
      storageDirectoryId: "", totalEpisodes: count, latestAiredEpisode: latest, latestAiredSource: knownSchedule ? "metadata" : "unknown",
    },
    keyword: media.title.trim(),
  } };
}
