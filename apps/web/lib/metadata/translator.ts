import type { MediaSearchCandidate } from "@media-track/workflow";
import type { UnifiedMedia } from "./types";

/** TMDB continues to use its original provider and tasks; this is a display adapter. */
export function translateTmdbCandidate(candidate: Pick<MediaSearchCandidate, "tmdbId" | "title" | "originalTitle" | "mediaType" | "year" | "posterPath" | "overview">): UnifiedMedia {
  return {
    source: "tmdb", tmdbId: candidate.tmdbId,
    title: candidate.title, originalTitle: candidate.originalTitle,
    aliases: candidate.originalTitle && candidate.originalTitle !== candidate.title ? [candidate.originalTitle] : [],
    mediaType: candidate.mediaType, year: candidate.year,
    posterUrl: candidate.posterPath ? `https://image.tmdb.org/t/p/w342${candidate.posterPath}` : null,
    overview: candidate.overview,
    // A series total must never be presented as the count of a chosen season.
    episodeCount: candidate.mediaType === "movie" ? 1 : null,
  };
}
