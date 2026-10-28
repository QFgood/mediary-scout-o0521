export const PROXY_SERVICES = ["anilist", "tmdb", "pansou", "assrt", "jev"] as const;
export type ProxyService = typeof PROXY_SERVICES[number];
export const PROXY_SERVICE_LABELS: Record<ProxyService, string> = {
  anilist: "AniList", tmdb: "TMDB", pansou: "PanSou", assrt: "assrt.net", jev: "Jev",
};
export const SERVICE_PROXY_SETTING_KEY = "service_socks5_proxy";
export interface ServiceProxyConfig { url: string; services: ProxyService[] }
export interface ProxySettingsSource { getSetting(key: string): Promise<string | null> }

/** Error text deliberately excludes the submitted URL, which may contain a password. */
export function normalizeSocks5Url(value: string): string {
  try {
    const url = new URL(value.trim());
    if (!["socks5:", "socks5h:"].includes(url.protocol) || !url.hostname || !url.port ||
        Number(url.port) < 1 || Number(url.port) > 65535 || (url.pathname && url.pathname !== "/") || url.search || url.hash) throw new Error();
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    return url.href.replace(/\/$/, "");
  } catch {
    throw new Error("代理地址需为 socks5://主机:端口 或 socks5h://主机:端口，可包含用户名和密码。");
  }
}

export async function getServiceProxyConfig(settings: ProxySettingsSource): Promise<ServiceProxyConfig> {
  const raw = await settings.getSetting(SERVICE_PROXY_SETTING_KEY);
  if (!raw) return { url: "", services: [] };
  try {
    const value = JSON.parse(raw) as ServiceProxyConfig;
    if (!Array.isArray(value.services)) throw new Error();
    if (value.url === "" && value.services.length === 0) return { url: "", services: [] };
    return { url: normalizeSocks5Url(value.url), services: PROXY_SERVICES.filter((s) => value.services.includes(s)) };
  } catch {
    // A damaged saved setting must never silently send selected traffic directly.
    throw new Error("SOCKS5 代理配置无效，请在设置中重新保存或清除。");
  }
}
