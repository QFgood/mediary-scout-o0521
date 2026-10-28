import Link from "next/link";
import { Film, RefreshCw, Search } from "lucide-react";
import { getTrending, TRENDING_KINDS, TRENDING_KIND_ORDER, type TrendingKind } from "../lib/trending";
import { getAnimeDiscovery, tmdbDiscoveryCards } from "../lib/anilist/discovery";
import type { AniListFeed } from "../lib/anilist/client";
import { anilistDetailsHref, mediaIdentityKey, metadataSearchHref, type MediaSource } from "../lib/metadata/types";

/** Reuse the discovery wall for TMDB movies/TV and AniList anime. AniList cards
 *  navigate by their own id; a TMDB fallback retains its TMDB search destination.
 *  `basePath` keeps navigation inside the active drive's workspace. */
export async function TrendingRow({
  activeKind,
  basePath,
  source = "tmdb",
  animeFeed = "trending",
}: {
  activeKind: TrendingKind;
  basePath: string;
  source?: MediaSource;
  animeFeed?: AniListFeed | undefined;
}) {
  const feed = activeKind === "anime" ? await getAnimeDiscovery(animeFeed) : {
    cards: tmdbDiscoveryCards(await getTrending(activeKind)), source: "tmdb" as const, stale: false, fallback: false,
  };
  const { cards } = feed;
  if (cards.length === 0) {
    return (
      <div className="quiet-state">
        <Search size={24} aria-hidden />
        <strong>输入目标名称</strong>
        <span>搜索后才会请求元数据。</span>
      </div>
    );
  }
  return (
    <section className="trending" aria-label="近期热门">
      <div className="trending-head">
        <div className="trending-tabs">
          <h2>近期热门</h2>
          {TRENDING_KIND_ORDER.map((kind) => (
            <Link
              key={kind}
              className={`filter-pill ${kind === activeKind ? "is-active" : ""}`}
              href={`${basePath}?${new URLSearchParams({ trending: kind, source: kind === "anime" ? source : "tmdb" })}`}
            >
              {TRENDING_KINDS[kind].label}
            </Link>
          ))}
        </div>
        <span className="trending-note">
          <RefreshCw size={12} aria-hidden />
          {feed.stale ? "历史缓存" : "定时更新"} · 来自 {feed.source === "anilist" ? "AniList" : "TMDB"}
          {feed.fallback ? "（AniList 暂无可用数据，已回退）" : ""}
        </span>
      </div>
      {activeKind === "anime" ? (
        <nav className="metadata-source-tabs" aria-label="动画榜单">
          {([ ["season", "本季动画"], ["trending", "近期热门"], ["upcoming", "即将播出"] ] as const).map(([value, label]) => (
            <Link className={`filter-pill ${animeFeed === value ? "is-active" : ""}`} key={value}
              aria-current={animeFeed === value ? "page" : undefined}
              href={`${basePath}?${new URLSearchParams({ trending: "anime", source, animeFeed: value })}`}>{label}</Link>
          ))}
        </nav>
      ) : null}
      <div className="trending-grid">
        {cards.map((card, index) => (
          <Link
            key={mediaIdentityKey(card)}
            className="trending-card"
            href={card.source === "anilist"
              ? anilistDetailsHref(card.anilistId, basePath.startsWith("/w/") ? basePath.slice(3) : undefined)
              : metadataSearchHref(basePath, card.title, "tmdb")}
          >
            <div className="trending-poster">
              {card.posterUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.posterUrl} alt="" loading="lazy" />
              ) : (
                <Film size={24} aria-hidden />
              )}
              <span className="trending-rank">#{index + 1}</span>
            </div>
            <span className="trending-title">{card.title}</span>
            <span className="trending-meta">
              {card.year ?? "—"} · {activeKind === "anime" ? "动漫" : card.mediaType === "movie" ? "电影" : "剧集"}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
