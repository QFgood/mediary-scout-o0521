/** Per-browser "last seen notifications" watermark (the 按浏览器消费 model). A
 *  single timestamp drives both the 通知 nav unread badge and the per-card NEW
 *  marks; opening the 通知 page advances it, clearing both. */
export const LAST_SEEN_KEY = "mt_notifications_last_seen";
export const NOTIFICATIONS_SEEN_EVENT = "mt-notifications-seen";
let sessionLastSeen = "";

export function getLastSeen(): string {
  try {
    const stored = localStorage.getItem(LAST_SEEN_KEY) ?? "";
    return stored;
  } catch {
    return sessionLastSeen;
  }
}

export function setLastSeen(value: string): void {
  if (value <= getLastSeen()) return;
  sessionLastSeen = value;
  try {
    localStorage.setItem(LAST_SEEN_KEY, sessionLastSeen);
  } catch {
    // storage unavailable (private mode) — degrade silently
  }
  window.dispatchEvent(new Event(NOTIFICATIONS_SEEN_EVENT));
}
