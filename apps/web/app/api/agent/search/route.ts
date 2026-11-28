import { connection, NextResponse, type NextRequest } from "next/server";
import { agentApiGuard } from "../../../../lib/agent-api/guard";
import { getOwnerAccountId } from "../../../../lib/agent-api/owner";
import { lookupAniListOriginalNames } from "../../../../lib/anilist/name-lookup";
import { getAniListSearchView } from "../../../../lib/anilist/search";
import { getAniListClient } from "../../../../lib/anilist/server-client";
import { isMovieUnreleased } from "@media-track/workflow";
import { getAgentMediaSearchProvider } from "../../../../lib/agent-api/search";

export async function GET(request: NextRequest) {
  await connection();
  const denied = await agentApiGuard(request);
  if (denied) {
    return denied;
  }

  const query = request.nextUrl.searchParams.get("query")?.trim();
  const source = request.nextUrl.searchParams.get("source") ?? "tmdb";
  const type = request.nextUrl.searchParams.get("type");
  if (!query || query.length > 256 || (source !== "tmdb" && source !== "anilist") ||
    (type !== null && (source !== "tmdb" || (type !== "movie" && type !== "tv")))) {
    return NextResponse.json({ error: "搜索条件无效" }, { status: 400 });
  }

  try {
    const accountId = await getOwnerAccountId();
    if (source === "anilist") {
      const view = await getAniListSearchView(
        query, undefined, await getAniListClient(accountId),
        (name) => lookupAniListOriginalNames(name, accountId),
      );
      if (view.state === "provider_error") throw new Error("AniList search unavailable");
      const now = new Date().toISOString();
      return NextResponse.json({
        source,
        items: view.candidates.map((media) => ({
          anilistId: media.anilistId,
          title: media.title,
          originalTitle: media.originalTitle,
          type: media.mediaType,
          year: media.year,
          overview: media.overview,
          posterUrl: media.posterUrl,
          episodeCount: media.episodeCount,
          reserve: media.status === "NOT_YET_RELEASED" ||
            (media.mediaType === "movie" && isMovieUnreleased(media.releaseDate, now, media.status ?? undefined)),
        })),
      });
    }
    const provider = await getAgentMediaSearchProvider(accountId);
    const matches = await provider.searchMedia({ query });
    const items = matches
      .filter((match) => type === null || match.mediaType === type)
      .map((match) => ({
        tmdbId: match.tmdbId,
        title: match.title,
        originalTitle: match.originalTitle,
        type: match.mediaType,
        year: match.year > 0 ? match.year : null,
        overview: match.overview,
        posterPath: match.posterPath ?? null,
        seasonNumbers: [...new Set(match.seasons.map((season) => season.seasonNumber))].sort((a, b) => a - b),
      }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ error: `巡影无法从 ${source === "anilist" ? "AniList" : "TMDB"} 获取搜索结果` }, { status: 502 });
  }
}
