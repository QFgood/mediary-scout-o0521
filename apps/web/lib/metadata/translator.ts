import type { MediaSearchCandidate } from "@media-track/workflow/search-view";
import type { UnifiedMedia } from "./types";

/** Keep the existing TMDB provider and task model intact. */
export function translateTmdbMedia(candidate: Pick<MediaSearchCandidate,
  "tmdbId" | "title" | "originalTitle" | "mediaType" | "year" | "posterPath" | "overview"
>): UnifiedMedia {
  return {
    source: "tmdb",
    tmdbId: candidate.tmdbId,
    title: candidate.title,
    originalTitle: candidate.originalTitle,
    aliases: [...new Set([candidate.title, candidate.originalTitle].filter(Boolean))],
    mediaType: candidate.mediaType,
    year: candidate.year || null,
    posterUrl: candidate.posterPath ? `https://image.tmdb.org/t/p/w342${candidate.posterPath}` : null,
    overview: candidate.overview,
    // TV search represents a series, not one selected season.
    episodeCount: candidate.mediaType === "movie" ? 1 : null,
  };
}
