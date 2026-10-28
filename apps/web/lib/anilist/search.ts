import type { AniListClient } from "./client";
import { getAniListClient } from "./server-client";
import type { AniListMetadata } from "./mapper";

export type AniListSearchView = {
  query: string;
  state: "empty" | "ready" | "provider_error";
  candidates: AniListMetadata[];
};

export async function getAniListSearchView(query: string, selectedId?: string, client?: Pick<AniListClient, "details" | "search">): Promise<AniListSearchView> {
  const normalized = query.trim().replace(/\s+/g, " ").slice(0, 200);
  if (!normalized && !selectedId) return { query: normalized, state: "empty", candidates: [] };
  try {
    const provider = client ?? await getAniListClient();
    if (selectedId) {
      const id = /^[1-9]\d*$/.test(selectedId) ? Number(selectedId) : NaN;
      if (!Number.isSafeInteger(id) || id > 2_147_483_647) throw new Error("AniList ID 无效");
      const media = await provider.details(id);
      return { query: normalized, state: "ready", candidates: media ? [media] : [] };
    }
    return { query: normalized, state: "ready", candidates: await provider.search(normalized) };
  } catch {
    return { query: normalized, state: "provider_error", candidates: [] };
  }
}
