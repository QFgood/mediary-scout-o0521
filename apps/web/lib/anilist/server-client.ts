import { AniListClient, anilistClient } from "./client";
import { DEFAULT_ANILIST_API_URL, resolveAniListApiUrl } from "./config";
import { createSocks5Fetch, serviceProxyUrl } from "../service-proxy";
import { getServiceProxyConfig } from "../service-proxy-config";

// Each endpoint owns its cache/cooldown. Changing settings takes effect immediately
// without serving cached metadata from the previously configured provider.
const clients = new Map<string, AniListClient>();

export async function getAniListClient(accountId?: string): Promise<AniListClient> {
  const runtime = await import("../workflow-runtime");
  const settings = runtime.getAccountScopedSettings(accountId ?? await runtime.getCurrentAccountId());
  const endpoint = await resolveAniListApiUrl(settings);
  const proxy = serviceProxyUrl(await getServiceProxyConfig(settings), "anilist");
  if (endpoint === DEFAULT_ANILIST_API_URL && !proxy) return anilistClient;
  const cacheKey = JSON.stringify([endpoint, proxy]);
  let client = clients.get(cacheKey);
  if (!client) {
    client = new AniListClient({ endpoint, ...(proxy ? { fetch: createSocks5Fetch(proxy) } : {}) });
    while (clients.size >= 32) clients.delete(clients.keys().next().value!);
    clients.set(cacheKey, client);
  }
  return client;
}
