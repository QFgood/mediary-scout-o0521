import { connection, NextResponse, type NextRequest } from "next/server";
import { agentApiGuard } from "../../../../lib/agent-api/guard";
import { getOwnerAccountId } from "../../../../lib/agent-api/owner";
import { getAgentMediaSearchProvider } from "../../../../lib/agent-api/search";

export async function GET(request: NextRequest) {
  await connection();
  const denied = await agentApiGuard(request);
  if (denied) {
    return denied;
  }

  const query = request.nextUrl.searchParams.get("query")?.trim();
  const type = request.nextUrl.searchParams.get("type");
  if (!query || query.length > 256 || (type !== null && type !== "movie" && type !== "tv")) {
    return NextResponse.json({ error: "搜索条件无效" }, { status: 400 });
  }

  try {
    const provider = await getAgentMediaSearchProvider(await getOwnerAccountId());
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
    return NextResponse.json({ error: "巡影无法从 TMDB 获取搜索结果" }, { status: 502 });
  }
}
