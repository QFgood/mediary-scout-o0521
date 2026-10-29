import type { AniListClient } from "./client";
import { getAniListClient } from "./server-client";
import type { AniListMetadata } from "./mapper";
import { lookupAniListOriginalNames } from "./name-lookup";

export type AniListSearchView = {
  query: string;
  state: "empty" | "ready" | "provider_error";
  candidates: AniListMetadata[];
  resolvedQueries?: string[];
  nameLookupUnavailable?: boolean;
};

export async function getAniListSearchView(query: string, selectedId?: string, client?: Pick<AniListClient, "details" | "search">,
  lookupNames: (query: string) => Promise<string[]> = lookupAniListOriginalNames): Promise<AniListSearchView> {
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
    const candidates = await provider.search(normalized);
    // Han-only inputs include Chinese names and some Japanese titles. Kana and
    // Latin inputs already work natively; never translate or rewrite those.
    if (!/\p{Script=Han}/u.test(normalized) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) {
      return { query: normalized, state: "ready", candidates };
    }
    try {
      // A localized alias often exists only on season 1. Its native title is
      // already authoritative: search that title just as a Japanese user would.
      // TMDB is only needed when AniList found no localized match at all.
      const resolved = candidates.length ? candidates.map((media) => media.originalTitle) : await lookupNames(normalized);
      const names = [...new Set(resolved.map((name) => name.trim().slice(0, 200)))]
        .filter((name) => name && name !== normalized).slice(0, 3);
      const results = await Promise.allSettled(names.map((name) => provider.search(name)));
      const found = new Map(candidates.map((media) => [media.anilistId, media]));
      const matchedNames: string[] = [];
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const name = names[index]!;
        // For a TMDB-derived name, confirm at least one exact title/alias first.
        // Once anchored, preserve the native query's whole result set, including
        // sequels and specials whose titles intentionally differ from season 1.
        const anchored = candidates.some((media) => nameKey(media.originalTitle) === nameKey(name)) ||
          result.value.some((media) => [media.title, media.originalTitle, ...media.aliases].some((title) => nameKey(title) === nameKey(name)));
        if (!anchored || !result.value.length) return;
        for (const media of result.value) found.set(media.anilistId, media);
        matchedNames.push(name);
      });
      return { query: normalized, state: "ready", candidates: [...found.values()], resolvedQueries: matchedNames,
        ...(results.some((result) => result.status === "rejected") ? { nameLookupUnavailable: true } : {}) };
    } catch {
      // The original AniList search succeeded. A secondary provider failure
      // must not be presented as an AniList outage.
      return { query: normalized, state: "ready", candidates, nameLookupUnavailable: true };
    }
  } catch {
    return { query: normalized, state: "provider_error", candidates: [] };
  }
}

function nameKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}
