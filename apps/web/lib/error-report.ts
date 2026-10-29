import { PROJECT_GITHUB_URL } from "./project-repository";
import type { WorkflowRepository, WorkflowScope } from "@media-track/workflow";

/** Deliberate allowlist: never copy raw logs, titles, URLs, credentials or file names. */
export function safeErrorCodes(messages: string[]): string[] {
  const codes = messages.flatMap((message) => message.match(/\b(?:QUARK|PAN115|PAN123|TIANYI|GUANGYA|ANILIST|TMDB|PANSOU|WORKFLOW)_[A-Z_]{3,80}\b/g) ?? []);
  return [...new Set(codes)].slice(0, 5);
}
export async function buildErrorReport(repository: WorkflowRepository, scope: WorkflowScope, commit: string | null): Promise<string> {
  const notifications = await repository.listNotifications({ ...scope, limit: 30 });
  const seen = new Set<string>();
  const failures: string[] = [];
  for (const notification of notifications) {
    if (seen.has(notification.workflowRunId)) continue;
    seen.add(notification.workflowRunId);
    const snapshot = await repository.getWorkflowRunSnapshot(notification.workflowRunId, scope);
    if (!snapshot || snapshot.workflowRun.status !== "failed") continue;
    const codes = safeErrorCodes(snapshot.workflowRun.auditEvents.map((event) => event.message));
    failures.push(`- ${snapshot.workflowRun.kind}: ${codes.join(", ") || "未提取到标准错误码，请补充问题描述"}`);
    if (failures.length >= 5) break;
  }
  return `## 问题描述\n请描述出现了什么问题。\n\n## 复现步骤\n1. \n2. \n\n## 预期与实际结果\n\n## 运行信息\n- 部署：Docker\n- 构建提交：${commit ?? "未知"}\n\n## 最近失败任务摘要\n${failures.join("\n") || "未找到近期失败任务。"}\n\n仅包含任务类型与标准错误码，未附原始日志、文件名、服务地址或凭证。\n`;
}
export function errorReportUrl(body: string): string {
  const url = new URL(`${PROJECT_GITHUB_URL}/issues/new`);
  url.searchParams.set("title", "[问题反馈] 请补充简要说明");
  url.searchParams.set("body", body);
  return url.toString();
}
