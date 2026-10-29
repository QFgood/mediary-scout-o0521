"use client";
import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { getLastSeen, setLastSeen, NOTIFICATIONS_SEEN_EVENT } from "../lib/notifications-seen";
import { isDemoModeClient } from "../lib/demo-mode";
import { demoSessionNotifications, listDemoAcquisitions } from "../lib/demo-session";
export function ClearNotifications({ storageId }: { storageId?: string | undefined }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const clear = async () => {
    setPending(true); setMessage("");
    try {
      const response = await fetch(`/api/notifications/meta${storageId ? `?w=${encodeURIComponent(storageId)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json() as { createdAts?: string[] };
      const times = [...(data.createdAts ?? []), ...(isDemoModeClient() ? demoSessionNotifications(listDemoAcquisitions()).map((n) => n.createdAt) : [])];
      const newest = times.filter((time) => Number.isFinite(Date.parse(time))).reduce((latest, time) => time > latest ? time : latest, getLastSeen());
      if (newest && newest > getLastSeen()) setLastSeen(newest);
      else window.dispatchEvent(new Event(NOTIFICATIONS_SEEN_EVENT));
      setMessage("未读标记已清除，通知历史保留。");
    } catch { setMessage("暂时无法读取通知，请重试。"); }
    finally { setPending(false); }
  };
  return <div className="sidebar-notification-tools"><button type="button" className="sidebar-utility" disabled={pending} onClick={() => { void clear(); }} title="将当前通知标为已读，保留历史"><CheckCheck size={13} aria-hidden />{pending ? "正在清除…" : "清除未读红点"}</button>{message ? <span className="sidebar-utility-message" role="status">{message}</span> : null}</div>;
}
