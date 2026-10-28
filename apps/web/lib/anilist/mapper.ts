import type { UnifiedMedia } from "../metadata/types";

export type AniListMedia = UnifiedMedia & {
  source: "anilist";
  anilistId: number;
  format: string | null;
  status: string | null;
  /** WINTER/SPRING/SUMMER/FALL is a broadcast period, NOT a sequel number. */
  broadcastSeason: string | null;
  popularity: number | null;
  nextAiringEpisode: number | null;
  relations: Array<{ anilistId: number; title: string; relation: "PREQUEL" | "SEQUEL" }>;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function titleOf(value: unknown): string {
  if (!isRecord(value)) return "";
  return text(value.native) || text(value.romaji) || text(value.english);
}

function posterUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ["s4.anilist.co", "s.anilist.co"].includes(url.hostname)
      ? url.href : null;
  } catch {
    return null;
  }
}

/** Render descriptions as plain text, never provider-supplied HTML. */
function plainDescription(value: unknown): string {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .trim();
}

export function mapAniListMedia(raw: unknown): AniListMedia | null {
  if (!isRecord(raw) || raw.type !== "ANIME" || raw.isAdult === true) return null;
  const id = positiveInteger(raw.id);
  const title = titleOf(raw.title);
  if (id === null || !title) return null;
  const titles = isRecord(raw.title) ? raw.title : {};
  const aliases = [...new Set([
    text(titles.native), text(titles.romaji), text(titles.english),
    ...(Array.isArray(raw.synonyms) ? raw.synonyms.map(text) : []),
  ].filter(Boolean))];
  const relations: AniListMedia["relations"] = [];
  const edges = isRecord(raw.relations) && Array.isArray(raw.relations.edges) ? raw.relations.edges : [];
  for (const edge of edges) {
    if (!isRecord(edge) || !isRecord(edge.node) || edge.node.type !== "ANIME") continue;
    if (edge.relationType !== "PREQUEL" && edge.relationType !== "SEQUEL") continue;
    const relationId = positiveInteger(edge.node.id);
    const relationTitle = titleOf(edge.node.title);
    if (relationId !== null && relationTitle) {
      relations.push({ anilistId: relationId, title: relationTitle, relation: edge.relationType });
    }
  }
  const cover = isRecord(raw.coverImage) ? raw.coverImage : {};
  return {
    source: "anilist", anilistId: id, title,
    originalTitle: text(titles.native) || text(titles.romaji) || title,
    aliases, mediaType: raw.format === "MOVIE" ? "movie" : "anime",
    year: positiveInteger(raw.seasonYear) ?? (isRecord(raw.startDate) ? positiveInteger(raw.startDate.year) : null),
    posterUrl: posterUrl(cover.extraLarge) ?? posterUrl(cover.large),
    overview: plainDescription(raw.description), episodeCount: positiveInteger(raw.episodes),
    format: text(raw.format) || null, status: text(raw.status) || null,
    broadcastSeason: text(raw.season) || null,
    popularity: positiveInteger(raw.popularity),
    nextAiringEpisode: isRecord(raw.nextAiringEpisode) ? positiveInteger(raw.nextAiringEpisode.episode) : null,
    relations,
  };
}
