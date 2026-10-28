export const DEFAULT_ANILIST_API_URL = "https://graphql.anilist.co";
export const ANILIST_API_URL_SETTING_KEY = "anilist_api_url";

/** A complete GraphQL endpoint, including any proxy path. */
export function normalizeAniListApiUrl(value: string): string {
  const text = value.trim();
  if (!text) return DEFAULT_ANILIST_API_URL;
  let url: URL;
  try { url = new URL(text); }
  catch { throw new Error("请填写完整的 HTTP 或 HTTPS GraphQL API 地址。"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error("API 地址须使用 HTTP 或 HTTPS，且不包含账号密码或 URL 片段。");
  }
  return url.pathname === "/" && !url.search ? url.origin : url.href;
}

export async function resolveAniListApiUrl(
  settings: { getSetting(key: string): Promise<string | null> },
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const saved = (await settings.getSetting(ANILIST_API_URL_SETTING_KEY))?.trim();
  return normalizeAniListApiUrl(saved || env.ANILIST_API_URL || "");
}
