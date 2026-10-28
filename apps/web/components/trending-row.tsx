import Link from "next/link";
import { Film, RefreshCw, Search } from "lucide-react";
import { getTrending, TRENDING_KINDS, TRENDING_KIND_ORDER, type TrendingKind } from "../lib/trending";
import { metadataSearchHref, type MediaSource } from "../lib/metadata/types";
import type { AnimeFeed } from "../lib/anilist/client";

const POSTER = "https://image.tmdb.org/t/p/w342";

/** The search page's empty-state discovery row. When getTrending yields []
 *  (proxy/network down) it falls back to the original "输入目标名称" placeholder,
 *  so the empty state is never blank and search is never blocked. Poster clicks
 *  navigate to `?q=<title>` so the pick lands in the normal results flow where the
 *  user explicitly chooses 获取. `basePath` is `/` or `/w/<id>` (never carries a
 *  query), so `?` is always the correct separator. */
export async function TrendingRow({
  activeKind,
  basePath,
  source = "tmdb",
  animeFeed = "trending",
}: {
  activeKind: TrendingKind;
  basePath: string;
  source?: MediaSource;
  animeFeed?: AnimeFeed;
}) {
  const cards = await getTrending(activeKind, animeFeed);
  const fromAniList = cards.some((card) => "source" in card && card.source === "anilist");
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
              href={`${basePath}?trending=${kind}&source=${source === "anilist" && kind === "anime" ? "anilist" : "tmdb"}`}
            >
              {TRENDING_KINDS[kind].label}
            </Link>
          ))}
        </div>
        <span className="trending-note">
          <RefreshCw size={12} aria-hidden /> 每日更新 · 来自 {fromAniList ? "AniList" : activeKind === "anime" ? "TMDB（AniList 暂不可用）" : "TMDB"}
        </span>
      </div>
      {activeKind === "anime" ? <nav className="trending-tabs" aria-label="动漫榜单">
        {([["season", "当季动画"], ["trending", "近期热门"], ["upcoming", "即将播出"]] as const).map(([feed, label]) => (
          <Link key={feed} className={`filter-pill ${feed === animeFeed ? "is-active" : ""}`}
            aria-current={feed === animeFeed ? "page" : undefined}
            href={`${basePath}?trending=anime&source=${source}&animeFeed=${feed}`}>{label}</Link>
        ))}
      </nav> : null}
      <div className="trending-grid">
        {cards.map((card, index) => {
          const ani = "anilistId" in card;
          const poster = ani ? card.posterUrl : card.posterPath ? `${POSTER}${card.posterPath}` : null;
          return (
          <Link
            key={ani ? `anilist_${card.anilistId}` : `${card.mediaType}_${card.tmdbId}`}
            className="trending-card"
            href={metadataSearchHref(basePath, ani ? "anilist" : "tmdb", card.title, ani ? card.anilistId : undefined)}
          >
            <div className="trending-poster">
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={poster} alt="" loading="lazy" />
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
        ); })}
      </div>
    </section>
  );
}
