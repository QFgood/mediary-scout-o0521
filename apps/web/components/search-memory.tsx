"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { lastQueryKey } from "@media-track/workflow/scope";
import { metadataSearchHref, parseMediaSource, type MediaSource } from "../lib/metadata/types";

/** Persists the current search query (per drive) so navigation can restore it. */
export function RememberQuery({ query, basePath = "/", source = "tmdb", anilistId = "" }: { query: string; basePath?: string; source?: MediaSource; anilistId?: string }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(lastQueryKey(basePath), query);
      sessionStorage.setItem(`${lastQueryKey(basePath)}:source`, source);
      sessionStorage.setItem(`${lastQueryKey(basePath)}:anilistId`, anilistId);
    } catch {
      // storage unavailable — nothing to remember
    }
  }, [query, basePath, source, anilistId]);
  return null;
}

/**
 * 搜索 nav entry that restores the last query (per drive): leaving for 媒体库/通知
 * and coming back must not reset the result list.
 */
export function SearchNavLink({
  active,
  knownQuery = "",
  basePath = "/",
}: {
  active: boolean;
  knownQuery?: string;
  /** Tree model: the active workspace path ("/w/<id>" or "/") so search stays in it. */
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <Link
      className={`nav-item ${active ? "is-active" : ""}`}
      href={`${basePath}?tab=search&q=${encodeURIComponent(knownQuery)}`}
      onClick={(event) => {
        let remembered = "";
        let source: MediaSource = "tmdb";
        let anilistId: number | undefined;
        try {
          remembered = sessionStorage.getItem(lastQueryKey(basePath)) ?? "";
          source = parseMediaSource(sessionStorage.getItem(`${lastQueryKey(basePath)}:source`) ?? "");
          const rawId = sessionStorage.getItem(`${lastQueryKey(basePath)}:anilistId`) ?? "";
          const id = Number(rawId);
          if (/^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(id) && id <= 2_147_483_647) anilistId = id;
        } catch {
          remembered = "";
        }
        if (remembered || knownQuery || anilistId) {
          event.preventDefault();
          router.push(metadataSearchHref(basePath, source, knownQuery || remembered, anilistId));
        }
      }}
    >
      <Search size={16} aria-hidden />
      搜索
    </Link>
  );
}
