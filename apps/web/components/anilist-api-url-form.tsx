"use client";

import { useState, useTransition } from "react";
import { Check, LoaderCircle, RotateCcw } from "lucide-react";
import { useRouter } from "../lib/use-router";
import { saveAniListApiUrlAction } from "../app/actions";
import { runAction } from "../lib/run-action";

export function AniListApiUrlForm({ apiUrl }: { apiUrl: string }) {
  const router = useRouter();
  const [value, setValue] = useState(apiUrl);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  function save(next: string) {
    startTransition(async () => {
      const result = await runAction(() => saveAniListApiUrlAction(next), setMessage);
      if (!result.ok) return;
      setMessage(result.value.success ? "保存成功，新的 API 地址已生效。" : result.value.message ?? "保存失败，请重试。");
      if (result.value.success) {
        setValue(result.value.apiUrl!);
        router.refresh();
      }
    });
  }
  return <div className="push-form">
    <label className="push-label" htmlFor="anilist-api-url">GraphQL API 地址</label>
    <div className="setting-row">
      <input id="anilist-api-url" type="url" className="setting-control" value={value} onChange={(event) => setValue(event.target.value)}
        placeholder="https://graphql.anilist.co" aria-label="AniList API 地址" autoComplete="off" />
      <button className="primary-button" type="button" onClick={() => save(value)} disabled={pending}>
        {pending ? <LoaderCircle size={14} className="spin" aria-hidden /> : <Check size={14} aria-hidden />}保存
      </button>
      <button className="secondary-button" type="button" onClick={() => save("")} disabled={pending}>
        <RotateCcw size={14} aria-hidden />恢复默认
      </button>
    </div>
    {message ? <p className="panel-note" role="status">{message}</p> : null}
  </div>;
}
