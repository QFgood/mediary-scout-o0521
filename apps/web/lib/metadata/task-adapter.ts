import { z } from "zod";
import type { PreparedTrackingTarget } from "@media-track/workflow";
import type { AniListMetadata } from "../anilist/mapper";

const mappingSchema = z.object({
  anilistId: z.number().int().positive().safe(),
  tmdbId: z.number().int().positive().safe(),
  seasonNumber: z.number().int().positive().max(999),
  episodeCount: z.number().int().positive().max(2000),
  /** Operator-reviewed evidence of a whole-season, 1:1 episode mapping. */
  evidenceUrl: z.url().refine((url) => url.startsWith("https://")),
}).strict();
export type VerifiedAnimeMapping = z.infer<typeof mappingSchema>;
export type AniListTaskCompatibility =
  | { supported: true; mapping: VerifiedAnimeMapping; target: PreparedTrackingTarget }
  | { supported: false; reason: string };

export function parseVerifiedMappings(raw: string | undefined): VerifiedAnimeMapping[] {
  if (!raw?.trim()) return [];
  const mappings = z.array(mappingSchema).max(500).parse(JSON.parse(raw));
  const sources = new Set<number>();
  const targets = new Set<string>();
  for (const mapping of mappings) {
    const target = `${mapping.tmdbId}:${mapping.seasonNumber}`;
    if (sources.has(mapping.anilistId) || targets.has(target)) throw new Error("AniList 季度映射重复，请检查配置。");
    sources.add(mapping.anilistId);
    targets.add(target);
  }
  return mappings;
}

export function parseAniListCandidateId(candidateId: string): number | null {
  const match = /^anilist_anime_([1-9]\d*)$/.exec(candidateId);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

/** A human-reviewed relationship is required; title similarity/count equality alone proves nothing. */
export async function adaptAniListTask(input: {
  media: AniListMetadata;
  mappings: VerifiedAnimeMapping[];
  prepareTarget: (mapping: VerifiedAnimeMapping) => Promise<PreparedTrackingTarget>;
}): Promise<AniListTaskCompatibility> {
  if (input.media.mediaType === "movie" || !["TV", "TV_SHORT", "ONA", "OVA"].includes(input.media.format ?? "")) {
    return { supported: false, reason: "此 AniList 类型暂不支持获取，请切换 TMDB 元数据。" };
  }
  const mapping = input.mappings.find((value) => value.anilistId === input.media.anilistId);
  if (!mapping) return { supported: false, reason: "尚无经核验的 TMDB 季度与集数映射，暂不能安全获取。可切换 TMDB 查找，或由管理员核验整季映射。" };
  if (!input.media.episodeCount || input.media.episodeCount !== mapping.episodeCount) {
    return { supported: false, reason: "AniList 集数未知或已变化，与已核验映射不一致，已阻止提交。" };
  }
  const target = await input.prepareTarget(mapping);
  if (target.title.tmdbId !== mapping.tmdbId || target.title.id !== `tmdb_tv_${mapping.tmdbId}` ||
      target.season.id !== `tmdb_tv_${mapping.tmdbId}_s${mapping.seasonNumber}` ||
      target.season.mediaTitleId !== target.title.id || target.season.seasonNumber !== mapping.seasonNumber ||
      target.season.totalEpisodes !== mapping.episodeCount || target.title.type !== "anime" ||
      !target.title.originCountries?.includes("JP")) {
    return { supported: false, reason: "TMDB 目标季度或集数与已核验映射不一致，已阻止提交；不支持跨季或连续集数拆分。" };
  }
  return {
    supported: true, mapping,
    target: {
      ...target,
      // Keep TMDB's canonical series title/keyword: a sequel's name as a series alias
      // could make the agent search a different season. Preserve AniList titles here.
      season: { ...target.season, metadataOrigin: {
        source: "anilist", anilistId: input.media.anilistId,
        title: input.media.title, aliases: input.media.aliases,
        episodeCount: input.media.episodeCount, evidenceUrl: mapping.evidenceUrl,
      } },
    },
  };
}
