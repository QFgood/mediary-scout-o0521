import { AniListClient, anilistClient } from "./client";
import { DEFAULT_ANILIST_API_URL, resolveAniListApiUrl } from "./config";

// Each endpoint owns its cache/cooldown. Changing settings takes effect immediately
// without serving cached metadata from the previously configured provider.
const clients = new Map<string, AniListClient>();

export async function getAniListClient(accountId?: string): Promise<AniListClient> {
  const runtime = await import("../workflow-runtime");
  const settings = runtime.getAccountScopedSettings(accountId ?? await runtime.getCurrentAccountId());
  const endpoint = await resolveAniListApiUrl(settings);
  if (endpoint === DEFAULT_ANILIST_API_URL) return anilistClient;
  let client = clients.get(endpoint);
  if (!client) {
    client = new AniListClient({ endpoint });
    while (clients.size >= 32) clients.delete(clients.keys().next().value!);
    clients.set(endpoint, client);
  }
  return client;
}
