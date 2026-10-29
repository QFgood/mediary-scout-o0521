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
    if (candidates.length || !/\p{Script=Han}/u.test(normalized) || /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) {
      return { query: normalized, state: "ready", candidates };
    }
    try {
      const names = [...new Set((await lookupNames(normalized)).map((name) => name.trim().slice(0, 200)))]
        .filter((name) => name && name !== normalized).slice(0, 3);
      const results = await Promise.allSettled(names.map((name) => provider.search(name)));
      const found = new Map<number, AniListMetadata>();
      const matchedNames: string[] = [];
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const name = names[index]!;
        // SEARCH_MATCH may return loosely related works. A title/alias must
        // match the resolved name before it can appear as a fallback candidate.
        for (const media of result.value) {
          if ([media.title, media.originalTitle, ...media.aliases].some((title) => nameKey(title) === nameKey(name))) {
            found.set(media.anilistId, media);
            if (!matchedNames.includes(name)) matchedNames.push(name);
          }
        }
      });
      return { query: normalized, state: "ready", candidates: [...found.values()], resolvedQueries: matchedNames,
        ...(results.some((result) => result.status === "rejected") ? { nameLookupUnavailable: true } : {}) };
    } catch {
      // The original AniList search succeeded. A secondary provider failure
      // must not be presented as an AniList outage.
      return { query: normalized, state: "ready", candidates: [], nameLookupUnavailable: true };
    }
  } catch {
    return { query: normalized, state: "provider_error", candidates: [] };
  }
}

function nameKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}
