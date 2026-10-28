import { connection, NextResponse, type NextRequest } from "next/server";
import { agentApiGuard } from "../../../../lib/agent-api/guard";
import { getOwnerAccountId } from "../../../../lib/agent-api/owner";
import { getWorkflowRepository } from "../../../../lib/workflow-runtime";

export async function GET(request: NextRequest) {
  await connection();
  const denied = await agentApiGuard(request);
  if (denied) {
    return denied;
  }
  const accountId = await getOwnerAccountId();
  const storageId = new URL(request.url).searchParams.get("storageId");
  const scope = { accountId, connectedStorageId: storageId || null };

  const states = await getWorkflowRepository().listTrackedSeasonStates(
    storageId ? scope : accountId,
  );

  const items = states.map((state) => {
    const airedMissing = state.episodes.filter(
      (episode) => episode.airStatus === "aired" && !episode.obtained,
    );
    return {
      title: state.title.title,
      tmdbId: state.title.tmdbId,
      ...(state.title.anilistId === undefined ? {} : { source: "anilist", anilistId: state.title.anilistId }),
      type: state.title.type,
      year: state.title.year,
      seasonNumber: state.season.seasonNumber,
      status: state.season.status,
      totalEpisodes: state.season.totalEpisodes,
      obtainedCount: state.episodes.filter((episode) => episode.obtained).length,
      missingAired: airedMissing.map((episode) => episode.episodeCode),
      connectedStorageId: state.connectedStorageId ?? null,
    };
  });

  return NextResponse.json({ count: items.length, items });
}
