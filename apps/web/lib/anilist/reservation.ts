import type { PreparedTrackingTarget, WorkflowRepository, WorkflowScope } from "@media-track/workflow";

export async function reserveAniListSeries(target: PreparedTrackingTarget, repository: WorkflowRepository, scope: WorkflowScope) {
  if (target.title.anilistStatus !== "NOT_YET_RELEASED" || target.title.source !== "anilist" || target.title.type !== "anime") throw new Error("Invalid reservation");
  const existing = await repository.getTrackedSeasonState(target.season.id, scope);
  if (existing) return { status: "already_tracked" as const, trackedSeasonId: target.season.id };
  const at = new Date().toISOString();
  const result = await repository.reserveWorkflowRun({
    ...scope, ...target, episodes: [],
    workflowRun: { id: `anime_reserved_${scope.accountId}_${scope.connectedStorageId}_${target.title.anilistId}`, kind: "type2_init", status: "reserved", trackedSeasonId: target.season.id,
      startedAt: at, finishedAt: null, auditEvents: [{ type: "anime_reserved", message: "预定未播动画，等待元数据排期。" }] },
    resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [], blockIfEpisodeStatesExist: true, blockIfTitleHasActiveRun: true,
  });
  return { status: result.status === "reserved" ? "reserved" as const : "already_running" as const, trackedSeasonId: target.season.id };
}
