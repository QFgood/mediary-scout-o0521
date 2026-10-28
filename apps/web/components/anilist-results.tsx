import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { anilistClient } from "../lib/anilist/client";
import type { AniListMedia } from "../lib/anilist/mapper";
import { adaptMetadataTask } from "../lib/metadata/task-adapter";
import { anilistDetailsHref, mediaIdentityKey, metadataSearchHref } from "../lib/metadata/types";
import type { AniListFeed } from "../lib/anilist/client";
import { TrendingRow } from "./trending-row";

export function AniListMediaCard({ media, basePath, storageId, details = false }: {
  media: AniListMedia; basePath: string; storageId?: string | undefined; details?: boolean;
}) {
  const href = anilistDetailsHref(media.anilistId, storageId);
  const decision = adaptMetadataTask(media, { mediaType: media.mediaType });
  const reason = decision.supported ? "" : decision.reason;
  const status: Record<string, string> = {
    FINISHED: "已完结", RELEASING: "播出中", NOT_YET_RELEASED: "未开播", CANCELLED: "已取消", HIATUS: "暂停播出",
  };
  const seasons: Record<string, string> = { WINTER: "冬季", SPRING: "春季", SUMMER: "夏季", FALL: "秋季" };
  return (
    <article className="candidate-card" data-metadata-source="anilist" data-media-id={mediaIdentityKey(media)}>
      <Link className="candidate-poster" href={href} aria-hidden tabIndex={-1}>
        {media.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.posterUrl} alt="" loading="lazy" />
        ) : <span>{media.title.slice(0, 4)}</span>}
      </Link>
      <div className="candidate-body">
        <div className="candidate-title-row">
          <div>
            <h3><Link href={href}>{media.title}</Link></h3>
            <p>{media.year ?? "年份待定"} · {media.format ?? "动画"} · AniList</p>
          </div>
          <div className="candidate-actions">
            <button className="primary-button" type="button" disabled title={reason}>获取（暂不兼容）</button>
          </div>
        </div>
        {media.overview ? <p className={details ? "anilist-description" : "candidate-overview"}>{media.overview}</p> : null}
        <div className="candidate-meta">
          <span>{media.episodeCount === null ? "集数未公布" : `共 ${media.episodeCount} 集`}</span>
          {media.status ? <span>{status[media.status] ?? media.status}</span> : null}
          {media.broadcastSeason ? <span>播出档期：{media.year ?? "—"} {seasons[media.broadcastSeason] ?? media.broadcastSeason}</span> : null}
          {media.nextAiringEpisode ? <span>下次播出第 {media.nextAiringEpisode} 集</span> : null}
          {media.popularity ? <span>热度 {media.popularity.toLocaleString("zh-CN")}</span> : null}
        </div>
        {details && media.aliases.length > 1 ? <p className="panel-note">别名：{media.aliases.join(" / ")}</p> : null}
        <p className="panel-note">{reason}</p>
        <Link className="filter-pill" href={metadataSearchHref(basePath, media.title, "tmdb")}>在 TMDB 搜索并确认目标</Link>
        {details && media.relations.length > 0 ? (
          <div className="anilist-relations" aria-label="前作与续作">
            {media.relations.map((relation) => (
              <Link className="filter-pill" key={`${relation.relation}_${relation.anilistId}`}
                href={anilistDetailsHref(relation.anilistId, storageId)}>
                {relation.relation === "PREQUEL" ? "前作" : "续作"}：{relation.title}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function AniListError({ retryHref }: { retryHref: string }) {
  return (
    <section className="search-results" aria-label="AniList 搜索结果">
      <div className="quiet-state compact" role="alert">
        <TriangleAlert size={22} aria-hidden />
        <strong>AniList 暂时不可用</strong>
        <span>请稍后重试，或切换到 TMDB 继续搜索。</span>
        <a className="primary-button" href={retryHref}>重试</a>
      </div>
    </section>
  );
}

export async function AniListSearchResults({ query, basePath, storageId, animeFeed }: {
  query: string; basePath: string; storageId?: string | undefined; animeFeed?: AniListFeed | undefined;
}) {
  if (!query.trim()) return <TrendingRow activeKind="anime" basePath={basePath} source="anilist" animeFeed={animeFeed} />;
  let result;
  try {
    result = await anilistClient.search(query);
  } catch {
    return <AniListError retryHref={metadataSearchHref(basePath, query, "anilist")} />;
  }
  return (
    <section className="search-results" aria-label="AniList 搜索结果">
      <div className="section-heading"><div>
        <h2>AniList 结果</h2>
        <p>{result.value.length} 个候选{result.status === "hit" ? "，来自缓存" : ""}</p>
        <p className="panel-note">续作保留独立条目；播出档期不代表作品的第几季。</p>
      </div></div>
      {result.value.length > 0 ? (
        <div className="candidate-grid">
          {result.value.map((media) => <AniListMediaCard key={mediaIdentityKey(media)} media={media} basePath={basePath} storageId={storageId} />)}
        </div>
      ) : (
        <div className="quiet-state compact"><strong>没有匹配结果</strong><span>可尝试日文、罗马字或英文标题；中文别名以 AniList 收录为准。</span></div>
      )}
    </section>
  );
}
