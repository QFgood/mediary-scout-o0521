import { z } from "zod";
import type { UnifiedMedia } from "../metadata/types";

export const anilistMediaSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal("ANIME"),
  isAdult: z.boolean(),
  countryOfOrigin: z.string().nullable(),
  title: z.object({ native: z.string().nullable(), romaji: z.string().nullable(), english: z.string().nullable() }),
  synonyms: z.array(z.string()).default([]),
  description: z.string().nullable(),
  coverImage: z.object({ large: z.string().nullable() }).nullable(),
  startDate: z.object({ year: z.number().int().nullable(), month: z.number().int().nullable().optional(), day: z.number().int().nullable().optional() }).nullable(),
  seasonYear: z.number().int().nullable(),
  season: z.string().nullable(),
  episodes: z.number().int().positive().nullable(),
  format: z.string().nullable(),
  status: z.string().nullable(),
  popularity: z.number().nonnegative().nullable(),
  nextAiringEpisode: z.object({ episode: z.number().int().positive(), airingAt: z.number().int() }).nullable().optional(),
  airingSchedule: z.object({ nodes: z.array(z.object({ episode: z.number().int().positive(), airingAt: z.number().int() })) }).nullable().optional(),
});

export type AniListMedia = z.infer<typeof anilistMediaSchema>;
export type AniListMetadata = UnifiedMedia & { source: "anilist"; anilistId: number };

/** Render as React text only; never pass the remote description to innerHTML. */
export function plainDescription(value: string | null): string {
  return (value ?? "").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
}

export function mapAniListMedia(raw: unknown): AniListMetadata | null {
  const result = anilistMediaSchema.safeParse(raw);
  if (!result.success) return null;
  const media = result.data;
  if (media.isAdult || media.countryOfOrigin !== "JP") return null;
  const titles = [media.title.native, media.title.romaji, media.title.english, ...media.synonyms]
    .filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim());
  const title = titles[0];
  if (!title) return null;
  const poster = media.coverImage?.large;
  return {
    source: "anilist", anilistId: media.id, title,
    originalTitle: media.title.native?.trim() || title,
    aliases: [...new Set(titles)].filter((value) => value !== title),
    mediaType: media.format === "MOVIE" ? "movie" : "anime",
    year: media.startDate?.year ?? media.seasonYear,
    ...(media.format === "MOVIE" ? { releaseDate: aniListReleaseDate(media.startDate) } : {}),
    posterUrl: poster?.startsWith("https://") ? poster : null,
    overview: plainDescription(media.description),
    episodeCount: media.episodes, format: media.format, status: media.status,
    broadcastSeason: media.season, popularity: media.popularity,
    ...(media.nextAiringEpisode === undefined ? {} : { nextAiringEpisode: media.nextAiringEpisode }),
    ...(media.airingSchedule ? { airingEpisodes: media.airingSchedule.nodes } : {}),
  };
}

function aniListReleaseDate(value: AniListMedia["startDate"]): string | null {
  if (!value?.year || !value.month || !value.day) return null;
  const text = `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}
