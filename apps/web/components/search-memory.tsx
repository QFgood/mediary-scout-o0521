"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { lastQueryKey } from "@media-track/workflow/scope";
import { metadataSearchHref, type MediaSource } from "../lib/metadata/types";
import { rememberedSearchHref } from "../lib/metadata/search-navigation";

/** Persists the current search query (per drive) so navigation can restore it. */
export function RememberQuery({ query, basePath = "/", source = "tmdb" }: { query: string; basePath?: string; source?: MediaSource }) {
  useEffect(() => {
    try {
      sessionStorage.setItem(lastQueryKey(basePath), query);
      sessionStorage.setItem(`${lastQueryKey(basePath)}:source`, source);
    } catch {
      // storage unavailable — nothing to remember
    }
  }, [query, basePath, source]);
  return null;
}

/**
 * 搜索 nav entry that restores the last query (per drive): leaving for 媒体库/通知
 * and coming back must not reset the result list.
 */
export function SearchNavLink({
  active,
  knownQuery = "",
  knownSource,
  basePath = "/",
}: {
  active: boolean;
  knownQuery?: string;
  knownSource?: MediaSource | undefined;
  /** Tree model: the active workspace path ("/w/<id>" or "/") so search stays in it. */
  basePath?: string;
}) {
  const router = useRouter();
  return (
    <Link
      className={`nav-item ${active ? "is-active" : ""}`}
      href={metadataSearchHref(basePath, knownQuery, knownSource ?? "tmdb")}
      onClick={(event) => {
        if (knownQuery) {
          return; // server-known query already in href
        }
        const remembered = rememberedSearchHref(basePath, (key) => sessionStorage.getItem(key));
        if (remembered) {
          event.preventDefault();
          router.push(remembered);
        }
      }}
    >
      <Search size={16} aria-hidden />
      搜索
    </Link>
  );
}
