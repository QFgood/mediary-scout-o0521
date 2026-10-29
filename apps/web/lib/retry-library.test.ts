import { describe, it, expect, vi } from "vitest";
import { retryLibraryFailures } from "./retry-library";
import type { WorkflowRepository } from "@media-track/workflow";
const scope = { accountId: "account-a", connectedStorageId: "drive-a" };
describe("library failure retry", () => {
  it("retries only the latest visible failed acquisition on the selected drive once", async () => {
    const rows = [
      { id: "good", titleId: "title-a", status: "failed", kind: "type2_init" },
      { id: "older", titleId: "title-a", status: "failed", kind: "type2_init" },
      { id: "complete", titleId: "title-b", status: "succeeded", kind: "movie_init" },
      { id: "old-failure", titleId: "title-b", status: "failed", kind: "movie_init" },
      { id: "patrol", titleId: "title-c", status: "failed", kind: "type3_monitor" },
      { id: "busy", titleId: "title-d", status: "failed", kind: "type2_init" },
      { id: "removed", titleId: "title-e", status: "failed", kind: "type2_init" },
    ];
    const repo = {
      listNotifications: vi.fn(async () => rows.map((row) => ({ workflowRunId: row.id }))),
      listActiveWorkflowRuns: vi.fn(async () => [{ title: { id: "title-d" } }]),
      getWorkflowRunSnapshot: vi.fn(async (id: string) => { const row = rows.find((r) => r.id === id)!; return { title: { id: row.titleId }, season: { id: row.titleId }, workflowRun: { id, status: row.status, kind: row.kind } }; }),
      getTrackedSeasonState: vi.fn(async (id: string) => id === "title-e" ? null : { title: {}, episodes: [], season: { status: "active" } }),
      retryFailedWorkflowRun: vi.fn(async () => ({ status: "retried" })),
    };
    expect(await retryLibraryFailures(repo as unknown as WorkflowRepository, scope)).toEqual({ retried: 1, skipped: 3 });
    expect(repo.retryFailedWorkflowRun).toHaveBeenCalledExactlyOnceWith("good", scope);
    expect(repo.listNotifications).toHaveBeenCalledWith({ ...scope, limit: 1000 });
    expect(repo.getWorkflowRunSnapshot).toHaveBeenCalledWith("good", scope);
  });
});
