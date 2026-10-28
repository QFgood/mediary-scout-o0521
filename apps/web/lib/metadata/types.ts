export type MediaSource = "tmdb" | "anilist";

export type MediaIdentity =
  | { source: "tmdb"; tmdbId: number }
  | { source: "anilist"; anilistId: number };

/** Calendar broadcast season is deliberately NOT an ordinal season number. */
export type UnifiedMedia = MediaIdentity & {
  title: string;
  originalTitle: string;
  aliases: string[];
  mediaType: "movie" | "tv" | "anime";
  year: number | null;
  posterUrl: string | null;
  overview: string;
  episodeCount: number | null;
  format?: string | null;
  status?: string | null;
  broadcastSeason?: string | null;
  popularity?: number | null;
  nextAiringEpisode?: { episode: number; airingAt: number } | null;
  airingEpisodes?: Array<{ episode: number; airingAt: number }>;
};

export function mediaIdentityKey(identity: MediaIdentity): string {
  return identity.source === "tmdb" ? `tmdb:${identity.tmdbId}` : `anilist:${identity.anilistId}`;
}

export function parseMediaSource(value: string): MediaSource {
  return value === "anilist" ? "anilist" : "tmdb";
}

export function metadataSearchHref(basePath: string, source: MediaSource, query: string, anilistId?: number): string {
  const params = new URLSearchParams({ tab: "search", source, q: query });
  if (source === "anilist" && anilistId !== undefined) params.set("anilistId", String(anilistId));
  return `${basePath}?${params}`;
}
