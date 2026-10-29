"use client";
import { useRef, useState } from "react";
import { Bug, ExternalLink, LoaderCircle } from "lucide-react";
import { prepareErrorReportAction } from "../app/actions";
import { errorReportUrl } from "../lib/error-report";
import { PROJECT_GITHUB_URL } from "../lib/project-repository";
export function ErrorReportButton({ storageId }: { storageId?: string | undefined }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const prepare = async () => {
    setPending(true); setMessage("");
    try { setBody(await prepareErrorReportAction(storageId)); dialog.current?.showModal(); }
    catch { setMessage("暂时无法生成摘要，可直接到 GitHub 反馈。"); }
    finally { setPending(false); }
  };
  return <>
    <button type="button" className="sidebar-utility sidebar-error-report" disabled={pending} onClick={() => { void prepare(); }}>{pending ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Bug size={14} aria-hidden />}{pending ? "整理错误摘要…" : "GitHub 错误反馈"}</button>
    {message ? <a className="sidebar-utility-message" href={`${PROJECT_GITHUB_URL}/issues/new`} target="_blank" rel="noopener noreferrer">{message}</a> : null}
    <dialog ref={dialog} className="error-report-dialog" aria-labelledby="error-report-title">
      <h2 id="error-report-title">提交错误反馈</h2><p>检查摘要并补充描述，然后前往 GitHub 确认提交。需要登录 GitHub；应用不会自动发布。</p>
      <textarea aria-label="错误反馈内容" value={body} maxLength={6000} onChange={(event) => setBody(event.target.value)} rows={15} />
      <div className="service-actions"><a className="primary-button" href={errorReportUrl(body)} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden />前往 GitHub 提交</a><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}>关闭</button></div>
    </dialog>
  </>;
}
