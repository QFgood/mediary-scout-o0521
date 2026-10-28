/** Source is part of identity; an AniList id must never become a TMDB id. */
export type MediaIdentity =
  | { source: "tmdb"; tmdbId: number; anilistId?: never }
  | { source: "anilist"; anilistId: number; tmdbId?: never };

export type MediaSource = MediaIdentity["source"];

export type UnifiedMedia = MediaIdentity & {
  title: string;
  originalTitle: string;
  aliases: string[];
  mediaType: "movie" | "tv" | "anime";
  year: number | null;
  posterUrl: string | null;
  overview: string;
  episodeCount: number | null;
};

export function mediaIdentityKey(identity: MediaIdentity): string {
  return identity.source === "anilist" ? `anilist_${identity.anilistId}` : `tmdb_${identity.tmdbId}`;
}

export function parseMediaSource(value: string | undefined): MediaSource {
  return value === "anilist" ? "anilist" : "tmdb";
}

export function metadataSearchHref(basePath: string, query: string, source: MediaSource): string {
  return `${basePath}?${new URLSearchParams({ tab: "search", q: query, source })}`;
}

export function anilistDetailsHref(id: number, storageId?: string): string {
  return `/anime/anilist/${id}${storageId ? `?${new URLSearchParams({ w: storageId })}` : ""}`;
}
