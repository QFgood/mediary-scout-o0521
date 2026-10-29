"use client";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { syncDriveLibraryAction } from "../app/actions";
import { useRouter } from "../lib/use-router";
import { runAction } from "../lib/run-action";
import type { LibrarySyncReport } from "@media-track/workflow";

export function LibrarySyncButton({ storageId }: { storageId?: string | undefined }) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<LibrarySyncReport | null>(null);
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div style={{ marginBottom: 16 }}>
    <div className="service-actions" style={{ justifyContent: "flex-end" }}>
      <button type="button" className="secondary-button" disabled={pending} onClick={() => startTransition(async () => {
        setReport(null); setMessage("正在扫描当前网盘已有资源，请保持页面打开……");
        const result = await runAction(() => syncDriveLibraryAction(storageId), setMessage);
        if (!result.ok) return;
        setReport(result.value.report ?? null);
        setMessage(result.value.success ? "同步完成。" : result.value.message ?? "同步失败，请稍后重试。");
        if (result.value.success) router.refresh();
      })}><RefreshCw size={14} className={pending ? "spin" : undefined} aria-hidden />{pending ? "同步中……" : "同步网盘资源"}</button>
    </div>
    <p className="panel-note">扫描当前网盘的电影、剧集和动漫分类目录，补回缺失的媒体库记录；已有记录保留，网盘文件不移动、不删除。</p>
    {message ? <p className="panel-note" role="status">{message}</p> : null}
    {report ? <div className="panel-note">
      <p>新增 {report.imported} 个作品/季度，恢复 {report.episodes} 集/部；已有 {report.existing} 项跳过，{report.issues.length} 项需要核对。</p>
      {report.issues.length ? <details><summary>查看未同步内容</summary><ul>{report.issues.map((item, index) => <li key={index}>{item.name}：{item.reason}</li>)}</ul></details> : null}
    </div> : null}
  </div>;
}
