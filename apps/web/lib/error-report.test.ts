import { describe, it, expect, vi } from "vitest";
import type { WorkflowRepository } from "@media-track/workflow";
import { buildErrorReport, errorReportUrl, safeErrorCodes } from "./error-report";
describe("GitHub error report draft", () => {
  it("includes only allowlisted codes and scoped technical facts, never raw failure details", async () => {
    const scope = { accountId: "owner", connectedStorageId: "drive" };
    const repo = { listNotifications: vi.fn(async () => [{ workflowRunId: "run" }]), getWorkflowRunSnapshot: vi.fn(async () => ({ title: { title: "private title" }, workflowRun: { status: "failed", kind: "type2_init", auditEvents: [{ message: "QUARK_CREATE_FOLDER_FAILED code=14012 Cookie=secret-token http://192.168.1.1/private-file" }] } })) };
    const report = await buildErrorReport(repo as unknown as WorkflowRepository, scope, "abc1234");
    expect(report).toContain("QUARK_CREATE_FOLDER_FAILED"); expect(report).toContain("abc1234");
    for (const value of ["secret-token", "192.168", "private-file", "private title"]) expect(report).not.toContain(value);
    expect(repo.listNotifications).toHaveBeenCalledWith({ ...scope, limit: 30 });
    expect(repo.getWorkflowRunSnapshot).toHaveBeenCalledWith("run", scope);
    const url = new URL(errorReportUrl(report));
    expect(url.origin + url.pathname).toBe("https://github.com/QFgood/mediary-scout-o0521/issues/new");
    expect(url.searchParams.get("body")).toBe(report);
  });
  it("deduplicates codes and omits arbitrary exception messages", () => {
    expect(safeErrorCodes(["QUARK_CREATE_FOLDER_FAILED QUARK_CREATE_FOLDER_FAILED", "password=hello raw exception"])).toEqual(["QUARK_CREATE_FOLDER_FAILED"]);
  });
});
