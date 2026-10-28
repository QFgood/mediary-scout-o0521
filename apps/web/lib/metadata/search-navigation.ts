import { lastQueryKey } from "@media-track/workflow/scope";
import { metadataSearchHref, parseMediaSource } from "./types";

/** Restore the destination drive's query AND source, including an empty AniList search. */
export function rememberedSearchHref(basePath: string, read: (key: string) => string | null): string | null {
  try {
    const query = read(lastQueryKey(basePath)) ?? "";
    const source = parseMediaSource(read(`${lastQueryKey(basePath)}:source`) ?? undefined);
    return query || source === "anilist" ? metadataSearchHref(basePath, query, source) : null;
  } catch {
    // Disabled/unavailable browser storage must leave normal navigation usable.
    return null;
  }
}
