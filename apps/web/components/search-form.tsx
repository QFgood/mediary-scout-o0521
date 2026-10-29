"use client";

import { useTransition } from "react";
import { SearchLoadBadge } from "./search-load-status";
import { Search, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { metadataSearchHref, type MediaSource } from "../lib/metadata/types";

/**
 * The search box. Submitting used to be a NATIVE `<form action>` GET — which is a
 * full document navigation (Next only intercepts <Link>/router.push), so the whole
 * page reloaded and the shell + header visibly flashed. Here onSubmit does a CLIENT
 * soft navigation instead: the prerendered static shell (sidebar + this header)
 * persists and only the results Suspense hole re-fetches — no full-page flash.
 *
 * `action`/hidden `tab` are kept so it still works as a plain GET if JS is off.
 */
export function SearchForm({
  basePath = "/",
  defaultQuery = "",
  source = "tmdb",
}: {
  basePath?: string;
  defaultQuery?: string;
  source?: MediaSource;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="search-form"
      role="search"
      action={basePath}
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("q") ?? "");
        startTransition(() => router.push(metadataSearchHref(basePath, source, value)));
      }}
    >
      <input type="hidden" name="tab" value="search" />
      <input type="hidden" name="source" value={source} />
      <label className="search-box search-box-large">
        <Search size={18} aria-hidden />
        {/* key forces a remount when the URL query changes (back/forward, or a
            restored remembered query) so the uncontrolled input reflects it,
            while staying uncontrolled (no re-render churn) during typing. */}
        <input
          key={defaultQuery}
          name="q"
          aria-label="搜索媒体"
          placeholder="片名 / 剧名"
          defaultValue={defaultQuery}
        />
      </label>
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? <LoaderCircle size={16} className="spin" aria-hidden /> : <Search size={16} aria-hidden />}
        {pending ? "加载中…" : "搜索"}
      </button>
      <SearchLoadBadge />
    </form>
  );
}
