import type { StorageExecutor } from "./ports.js";
import { storageTitleName } from "./storage-name.js";

function folderYear(year: number | string | null | undefined): string {
  if (year === null || year === undefined || year === "" || year === 0 || year === "0") {
    return "—";
  }
  return String(year);
}

/** Canonical cloud folder name for a title root under Movies/TV/Anime. */
function rawMediaLibraryFolderName(input: {
  title: string;
  year: number | string | null | undefined;
  tmdbId: number | null;
  anilistId?: number | undefined;
}): string {
  if (input.tmdbId === null) {
    if (!Number.isSafeInteger(input.anilistId) || input.anilistId! <= 0) throw new Error("Native title requires an AniList ID");
    return `${input.title} (${folderYear(input.year)}) {anilist-${input.anilistId}}`;
  }
  return `${input.title} (${folderYear(input.year)}) {tmdb-${input.tmdbId}}`;
}

export function mediaLibraryFolderName(input: Parameters<typeof rawMediaLibraryFolderName>[0]): string {
  return rawMediaLibraryFolderName({ ...input, title: storageTitleName(input.title) });
}

/** The `{tmdb-N}` suffix of a new-style folder, or null for a legacy name. */
export function tmdbIdFromMediaLibraryFolderName(name: string): number | null {
  const match = /\{tmdb-(\d+)\}$/.exec(name.trim());
  if (!match?.[1]) return null;
  const tmdbId = Number(match[1]);
  return Number.isSafeInteger(tmdbId) ? tmdbId : null;
}

/** Pre-tmdb-suffix name. Kept so existing pan folders are reused, not duplicated. */
export function legacyMediaLibraryFolderName(input: {
  title: string;
  year: number | string | null | undefined;
}): string {
  return `${input.title} (${folderYear(input.year)})`;
}

/**
 * Find-or-create the title root under a category parent.
 * Prefer the new `{tmdb-N}` name; if only the legacy `Title (Year)` exists, reuse it
 * (do not auto-rename this round).
 */
export async function ensureMediaLibraryDirectory(input: {
  executor: Pick<StorageExecutor, "createDirectory" | "listChildDirectories">;
  parentId: string;
  title: string;
  year: number | string | null | undefined;
  tmdbId: number | null;
  anilistId?: number | undefined;
}): Promise<string> {
  const preferred = mediaLibraryFolderName({
    title: input.title,
    year: input.year,
    tmdbId: input.tmdbId,
    ...(input.anilistId === undefined ? {} : { anilistId: input.anilistId }),
  });
  const legacy = legacyMediaLibraryFolderName({ title: input.title, year: input.year });
  const rawPreferred = rawMediaLibraryFolderName(input);
  const safeLegacy = legacyMediaLibraryFolderName({ title: storageTitleName(input.title), year: input.year });

  const children = await input.executor.listChildDirectories(input.parentId);
  const hitPreferred = children.find((child) => child.name === preferred);
  if (hitPreferred) return hitPreferred.id;
  // Other drives may already have accepted the original punctuation. Reuse
  // those exact old names rather than creating a second library directory.
  const hitRaw = children.find((child) => child.name === rawPreferred);
  if (hitRaw) return hitRaw.id;
  // A native entry must not adopt an untagged series folder: it may contain other seasons.
  const hitLegacy = input.tmdbId === null ? undefined : children.find((child) => child.name === legacy || child.name === safeLegacy);
  if (hitLegacy) return hitLegacy.id;

  return input.executor.createDirectory({ name: preferred, parentId: input.parentId });
}
