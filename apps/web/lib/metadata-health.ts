import { fetchTmdbList } from "@media-track/workflow";
import { AniListClient } from "./anilist/client";
import { resolveAniListApiUrl } from "./anilist/config";
import { getServiceProxyFetch } from "./service-proxy";
import { getAccountScopedSettings, getTmdbAccesses } from "./workflow-runtime";

export interface MetadataHealth { service: "TMDB" | "AniList"; ok: boolean; latencyMs: number; }
const cache = new Map<string, { at: number; result: Promise<MetadataHealth[]> }>();
export function getMetadataHealth(accountId: string): Promise<MetadataHealth[]> {
  const current = cache.get(accountId);
  if (current && Date.now() - current.at < 60_000) return current.result;
  const result = probe(accountId);
  while (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(accountId, { at: Date.now(), result });
  return result;
}
async function probe(accountId: string): Promise<MetadataHealth[]> {
  const settings = getAccountScopedSettings(accountId);
  const check = async (service: MetadataHealth["service"], call: () => Promise<unknown>): Promise<MetadataHealth> => {
    const started = Date.now();
    try { await call(); return { service, ok: true, latencyMs: Date.now() - started }; }
    catch { return { service, ok: false, latencyMs: Date.now() - started }; }
  };
  return Promise.all([
    check("TMDB", async () => {
      const accesses = (await getTmdbAccesses(settings)).map((access) => ({ ...access, fetchImpl: ((url, init) => (access.fetchImpl ?? fetch)(url, { ...init, signal: AbortSignal.timeout(5000) })) as typeof fetch }));
      await fetchTmdbList(accesses, "configuration");
    }),
    check("AniList", async () => {
      const endpoint = await resolveAniListApiUrl(settings);
      const transport = await getServiceProxyFetch(settings, "anilist");
      await new AniListClient({ endpoint, fetch: transport ?? fetch, timeoutMs: 5000 }).search("__metadata_health__");
    }),
  ]);
}
