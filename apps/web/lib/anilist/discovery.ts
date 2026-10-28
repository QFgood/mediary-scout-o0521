import { getTrending, type TrendingCard } from "../trending";
import { anilistClient, type AniListClient, type AniListFeed } from "./client";
import type { MediaIdentity, MediaSource } from "../metadata/types";

export type DiscoveryCard = MediaIdentity & {
  title: string; year: number | null; posterUrl: string | null; mediaType: "movie" | "tv" | "anime";
};
export interface DiscoveryFeed {
  cards: DiscoveryCard[];
  source: MediaSource;
  stale: boolean;
  fallback: boolean;
}

export function tmdbDiscoveryCards(cards: TrendingCard[]): DiscoveryCard[] {
  return cards.map((card) => ({
    source: "tmdb", tmdbId: card.tmdbId, title: card.title, year: card.year,
    posterUrl: card.posterPath ? `https://image.tmdb.org/t/p/w342${card.posterPath}` : null,
    mediaType: card.mediaType,
  }));
}

/** AniList owns the anime row. Stale data wins over the TMDB fallback. */
export async function getAnimeDiscovery(
  feed: AniListFeed = "trending",
  deps: { client: Pick<AniListClient, "trending">; fallback: () => Promise<TrendingCard[]> } = {
    client: anilistClient, fallback: () => getTrending("anime"),
  },
): Promise<DiscoveryFeed> {
  try {
    const result = await deps.client.trending(feed);
    if (result.value.length > 0) {
      return { cards: result.value, source: "anilist", stale: result.status === "stale", fallback: false };
    }
  } catch {
    // An AniList outage must not take down the existing discovery surface.
  }
  try {
    return { cards: tmdbDiscoveryCards(await deps.fallback()), source: "tmdb", stale: false, fallback: true };
  } catch {
    return { cards: [], source: "tmdb", stale: false, fallback: true };
  }
}
