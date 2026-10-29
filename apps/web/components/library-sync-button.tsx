"use client";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncDriveLibraryAction, retryLibraryFailuresAction } from "../app/actions";
import { useRouter } from "../lib/use-router";
import { runAction } from "../lib/run-action";
import type { LibrarySyncReport } from "@media-track/workflow";

export function LibrarySyncButton({ storageId }: { storageId?: string | undefined }) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<LibrarySyncReport | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div className="library-sync-controls">
    <div className="library-sync-action">
      <button type="button" className="secondary-button" disabled={pending} onClick={() => startTransition(async () => {
        setReport(null); setMessage("正在重试当前网盘的失败任务……");
        const result = await runAction(() => retryLibraryFailuresAction(storageId), setMessage);
        if (!result.ok) return;
        setMessage(`已重试 ${result.value.retried} 个失败任务，跳过 ${result.value.skipped} 项。正在运行、已完成和未播出任务不会重复提交。`);
        router.refresh();
      })}><RefreshCw size={14} aria-hidden />一键重试</button>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => startTransition(async () => {
        setReport(null); setMessage("正在扫描当前网盘已有资源，请保持页面打开……");
        const result = await runAction(() => syncDriveLibraryAction(storageId), setMessage);
        if (!result.ok) return;
        setReport(result.value.report ?? null);
        setMessage(result.value.success ? "同步完成。" : result.value.message ?? "同步失败，请稍后重试。");
        if (result.value.success) router.refresh();
      })}><RefreshCw size={14} className={pending ? "spin" : undefined} aria-hidden />{pending ? "同步中……" : "同步网盘资源"}</button>
    </div>
    <p className="library-sync-description">扫描原电影、剧集和动漫目录，恢复并核对入库集数；确认缺少的已播集自动提交补集任务。</p>
    {message ? <p className="panel-note library-sync-report" role="status">{message}</p> : null}
    {report ? <div className="panel-note library-sync-report">
      <p>新增 {report.imported} 个作品/季度，修正 {report.updated} 项，恢复 {report.episodes} 集/部；复核已有 {report.existing} 项，发现 {report.missingEpisodes} 集已播缺集，已提交 {report.queued} 个补集任务，{report.issues.length} 项需要核对。</p>
      {report.issues.length ? <details><summary>查看需核对内容</summary><ul>{report.issues.map((item, index) => <li key={index}>{item.name}：{item.reason}</li>)}</ul></details> : null}
    </div> : null}
  </div>;
}
