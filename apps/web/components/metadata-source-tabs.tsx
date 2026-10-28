import Link from "next/link";
import { metadataSearchHref, type MediaSource } from "../lib/metadata/types";

export function MetadataSourceTabs({ source, query, basePath }: { source: MediaSource; query: string; basePath: string }) {
  return (
    <nav className="metadata-source-tabs" aria-label="元数据来源">
      {(["tmdb", "anilist"] as const).map((value) => (
        <Link key={value} className={`filter-pill ${source === value ? "is-active" : ""}`}
          aria-current={source === value ? "page" : undefined}
          href={metadataSearchHref(basePath, query, value)}>
          {value === "tmdb" ? "TMDB 元数据" : "AniList 元数据"}
        </Link>
      ))}
    </nav>
  );
}
