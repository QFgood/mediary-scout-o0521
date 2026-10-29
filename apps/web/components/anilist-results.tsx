import { SearchLoadComplete } from "./search-load-status";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { mediaHref } from "@media-track/workflow/scope";
import { getAniListSearchView } from "../lib/anilist/search";
import type { AniListMetadata } from "../lib/anilist/mapper";
import { getAniListAcquisitionTarget } from "../lib/anilist/task";
import { metadataSearchHref } from "../lib/metadata/types";
import { getActiveWorkspaceScope, getWorkflowRepository } from "../lib/workflow-runtime";
import { isDemoMode } from "../lib/demo-mode";
import { RequestTrackButton } from "./request-track-button";
import { AcquireProgressBadge } from "./acquire-progress-badge";
import { AcquiringPoller } from "./acquiring-poller";
import { TrendingRow } from "./trending-row";
import type { AnimeFeed } from "../lib/anilist/client";
import { isMovieUnreleased } from "@media-track/workflow";

export async function AniListResults({ query, selectedId, basePath, storageId, animeFeed }: {
  query: string; selectedId: string; basePath: string; storageId: string | undefined; animeFeed: AnimeFeed;
}) {
  const view = await getAniListSearchView(query, selectedId);
  if (view.state === "empty") return <TrendingRow activeKind="anime" basePath={basePath} source="anilist" animeFeed={animeFeed} />;
  if (view.state === "provider_error") return (
    <section className="search-results" aria-label="AniList 搜索结果">
      <SearchLoadComplete failed />
      <div className="quiet-state compact" role="alert">
        <TriangleAlert size={22} aria-hidden />
        <strong>暂时连不上 AniList 元数据服务</strong>
        <span>请稍后重试，或切换 TMDB 元数据继续搜索。</span>
        <a className="primary-button" href={metadataSearchHref(basePath, "anilist", query, selectedId ? Number(selectedId) : undefined)}>重试</a>
        <Link href={metadataSearchHref(basePath, "tmdb", query)}>切换 TMDB</Link>
      </div>
    </section>
  );
  return (
    <section className="search-results" aria-label="AniList 搜索结果">
      <div className="section-heading"><div><h2>结果</h2><p>{view.candidates.length} 个候选 · 来自 AniList</p></div></div>
      <p className="panel-note">每个条目代表 AniList 收录的独立作品或续作；播出季度不等于「第几季」。</p>
      {Boolean(view.resolvedQueries?.length) && <p className="panel-note">已按作品原名补充搜索 AniList：{view.resolvedQueries!.join("、")}</p>}
      {view.nameLookupUnavailable && <p className="panel-note">中文名称辅助查询暂未完成，可重试或直接输入日文、英文或罗马字名称。</p>}
      {view.candidates.length ? (
        <div className="candidate-grid">{view.candidates.map((media) => <AniListCandidateCard key={`anilist:${media.anilistId}`} media={media} storageId={storageId} />)}</div>
      ) : <div className="quiet-state compact"><strong>没有匹配结果</strong><span>可尝试作品的日文、英文或罗马字名称。</span></div>}
    </section>
  );
}

const SEASONS: Record<string, string> = { WINTER: "冬季", SPRING: "春季", SUMMER: "夏季", FALL: "秋季" };
const STATUSES: Record<string, string> = { FINISHED: "已完结", RELEASING: "播出中", NOT_YET_RELEASED: "尚未播出", CANCELLED: "已取消", HIATUS: "暂停播出" };

export async function AniListCandidateCard({ media, storageId }: { media: AniListMetadata; storageId?: string | undefined }) {
  const compatibility = await getAniListAcquisitionTarget(media);
  const scope = compatibility.supported ? await getActiveWorkspaceScope(storageId) : undefined;
  const state = compatibility.supported ? await getWorkflowRepository().getTrackedSeasonState(compatibility.target.season.id, scope) : null;
  const active = compatibility.supported ? await getWorkflowRepository().findActiveWorkflowRun({
    trackedSeasonId: compatibility.target.season.id, kind: compatibility.target.title.type === "movie" ? "movie_init" : "type2_init", ...scope,
  }) : null;
  const externalHref = `https://anilist.co/anime/${media.anilistId}`;
  const detailHref = compatibility.supported ? mediaHref(compatibility.target.title, "search", storageId) : externalHref;
  const address = compatibility.supported ? compatibility.target.title : null;
  const unreleased = media.status === "NOT_YET_RELEASED" || (address?.type === "movie" && isMovieUnreleased(address.releaseDate, new Date().toISOString(), address.anilistStatus));
  return (
    <article className="candidate-card">
      <Link className="candidate-poster" href={detailHref} aria-label={`${media.title} 的详情`}>
        {media.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.posterUrl} alt="" loading="lazy" />
        ) : <span>{media.title.slice(0, 4)}</span>}
      </Link>
      <div className="candidate-body">
        <div className="candidate-title-row">
          <div><h3><Link href={detailHref}>{media.title}</Link></h3>
            <p>{media.year ?? "年份未知"} · {media.format ?? "动漫"} · AniList</p></div>
          <div className="candidate-actions">
            {compatibility.supported && active ? <><AcquiringPoller /><AcquireProgressBadge tmdbId={address!.tmdbId} anilistId={address!.anilistId} seasonNumber={compatibility.target.season.seasonNumber} storageId={storageId} /></>
              : compatibility.supported && unreleased && !isDemoMode() ? <RequestTrackButton candidateId={`anilist_anime_${media.anilistId}`} anilistId={media.anilistId} storageId={storageId} actionState={state ? "reserved" : "can_reserve"} label={state ? "已预定" : "预定"} />
              : compatibility.supported && state ? <Link className="primary-button" href={detailHref}>查看获取状态</Link>
              : compatibility.supported && !isDemoMode() ? <RequestTrackButton candidateId={`anilist_anime_${media.anilistId}`} {...(address!.tmdbId === null ? { anilistId: address!.anilistId } : { tmdbId: address!.tmdbId })} storageId={storageId} />
              : <button className="primary-button" disabled title={compatibility.supported ? "演示站为只读" : compatibility.reason}>获取</button>}
          </div>
        </div>
        {media.overview ? <p className="candidate-overview">{media.overview}</p> : null}
        <div className="candidate-meta">
          <span>{media.format === "MOVIE" ? "电影" : media.episodeCount === null ? "集数未定" : `共 ${media.episodeCount} 集`}</span>
          {media.broadcastSeason ? <span>播出季度：{SEASONS[media.broadcastSeason] ?? media.broadcastSeason}</span> : null}
          {media.status ? <span>{STATUSES[media.status] ?? media.status}</span> : null}
        </div>
        {media.aliases.length ? <p className="panel-note">别名：{media.aliases.join(" / ")}</p> : null}
        <p className="panel-note">{compatibility.supported ? compatibility.mode === "native"
          ? media.format === "MOVIE" ? "未上映电影支持预定；上映后巡检自动尝试获取。" : "按此 AniList 条目的集数范围获取，后续播出自动追踪。"
          : `已核验：对应 TMDB 第 ${compatibility.target.season.seasonNumber} 季（${compatibility.target.season.totalEpisodes} 集）` : compatibility.reason}</p>
      </div>
    </article>
  );
}
