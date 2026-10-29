import { isQueueClaimableKind, isUserVisibleWorkflowKind, isMovieUnreleased, type WorkflowRepository, type WorkflowScope } from "@media-track/workflow";

export async function retryLibraryFailures(repository: WorkflowRepository, scope: WorkflowScope) {
  const events = await repository.listNotifications({ ...scope, limit: 1000 });
  const active = new Set((await repository.listActiveWorkflowRuns(scope)).map((run) => run.title.id));
  const seen = new Set<string>();
  let retried = 0;
  let skipped = 0;
  for (const event of events) {
    const snapshot = await repository.getWorkflowRunSnapshot(event.workflowRunId, scope);
    if (!snapshot || seen.has(snapshot.title.id)) continue;
    seen.add(snapshot.title.id);
    if (snapshot.workflowRun.status !== "failed") continue;
    const current = await repository.getTrackedSeasonState(snapshot.season.id, scope);
    if (!current || (current.episodes.length > 0 && current.episodes.every((episode) => episode.obtained)) || active.has(snapshot.title.id) ||
      !isQueueClaimableKind(snapshot.workflowRun.kind) || !isUserVisibleWorkflowKind(snapshot.workflowRun.kind) ||
      (current.title.anilistStatus === "NOT_YET_RELEASED" || current.title.type === "movie" && isMovieUnreleased(current.title.releaseDate, new Date().toISOString(), current.title.anilistStatus))) { skipped++; continue; }
    const result = await repository.retryFailedWorkflowRun(snapshot.workflowRun.id, scope);
    if (result.status === "retried") { retried++; active.add(snapshot.title.id); } else skipped++;
  }
  return { retried, skipped };
}
