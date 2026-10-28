import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { getTrackedSeasonStatusView, type EpisodeDisplayState } from "@media-track/workflow";
import { mediaPosterUrl } from "@media-track/workflow/scope";
import { AppSidebar } from "../../../../components/app-sidebar";
import { BackLink } from "../../../../components/back-link";
import { GitHubNameplate } from "../../../../components/github-nameplate";
import { RequestTrackButton } from "../../../../components/request-track-button";
import { AcquireProgressBadge } from "../../../../components/acquire-progress-badge";
import { AcquiringPoller } from "../../../../components/acquiring-poller";
import { UntrackButton } from "../../../../components/untrack-button";
import { anilistClient } from "../../../../lib/anilist/client";
import { prepareNativeAniListTarget } from "../../../../lib/anilist/native-target";
import { isDemoMode } from "../../../../lib/demo-mode";
import { getWorkflowRepository, resolveGlobalWorkspace } from "../../../../lib/workflow-runtime";

const LABELS: Record<EpisodeDisplayState, string> = {
  obtained: "已获取", missing_aired: "待获取", unaired: "未播出", provider_ahead: "资源先行", unknown: "状态未定",
};

export default function AniListDetailPage(props: {
  params: Promise<{ anilistId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <Suspense fallback={<main className="main product-main" aria-busy="true">正在读取动画条目…</main>}><AniListDetail {...props} /></Suspense>;
}

async function AniListDetail({ params, searchParams }: {
  params: Promise<{ anilistId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const rawId = (await params).anilistId;
  const id = /^[1-9]\d*$/.test(rawId) ? Number(rawId) : NaN;
  const query = await searchParams ?? {};
  const workspace = await resolveGlobalWorkspace(typeof query.w === "string" ? query.w : undefined);
  const from = query.from === "library" ? "library" : "search";
  const back = `${workspace.basePath}?tab=${from}${from === "search" ? "&source=anilist" : ""}`;
  const repository = getWorkflowRepository();
  const scope = { accountId: workspace.accountId, connectedStorageId: workspace.connectedStorageId };
  const seasonId = `anilist_anime_${id}_s1`;
  const valid = Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647;
  const tracked = valid ? await repository.getTrackedSeasonState(seasonId, scope) : null;
  let target = tracked ? { title: tracked.title, season: tracked.season } : null;
  let unavailable = "未找到该 AniList 动画条目。";
  if (!target && valid) {
    try {
      const media = await anilistClient.details(id);
      if (media) {
        const prepared = prepareNativeAniListTarget(media);
        if (prepared.supported) target = prepared.target;
        else unavailable = prepared.reason;
      }
    } catch { unavailable = "AniList 元数据暂时不可用，请稍后重试。"; }
  }
  const active = valid ? (await repository.listActiveWorkflowRuns(scope)).find((run) => run.title.id === `anilist_anime_${id}`) : null;
  const status = tracked ? await getTrackedSeasonStatusView({ repository, trackedSeasonId: seasonId, scope }) : null;
  const poster = mediaPosterUrl(target?.title.posterPath);
  return (
    <div className="app-shell">
      <AppSidebar active={from} basePath={workspace.basePath} activeStorageId={workspace.activeStorageId} />
      <main className="main product-main product-main-hub">
        <BackLink label={from === "library" ? "媒体库" : "搜索"} fallbackHref={back} />
        {target ? <section className="title-hub">
          {active ? <AcquiringPoller /> : null}
          <header className="hub-header">
            <div className="hub-poster">{poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt={`${target.title.title} 海报`} />
            ) : <span className="poster-fallback">{target.title.title.slice(0, 4)}</span>}</div>
            <div className="hub-title-block">
              <h1>{target.title.title}</h1>
              <p className="hub-attributes">AniList · {target.title.year || "年份未定"} · 共 {target.season.totalEpisodes} 集</p>
              <p className="panel-note">按该独立动画条目的相对集号获取与追更。</p>
              <div className="hub-actions">
                {active ? <AcquireProgressBadge tmdbId={null} anilistId={id} storageId={workspace.activeStorageId} />
                  : !isDemoMode() && (!tracked || !tracked.episodes.length) ? <RequestTrackButton candidateId={`anilist_anime_${id}`} anilistId={id} storageId={workspace.activeStorageId} /> : null}
                {tracked && !isDemoMode() ? <UntrackButton tmdbId={null} anilistId={id} mediaKind="tv" storageId={workspace.activeStorageId} basePath={workspace.basePath} /> : null}
                <a href={`https://anilist.co/anime/${id}`} target="_blank" rel="noreferrer">AniList 资料</a>
              </div>
            </div>
          </header>
          {target.title.overview ? <p className="hub-synopsis">{target.title.overview}</p> : null}
          <p>已获取 {status?.obtainedCount ?? 0} 集 · {target.season.latestAiredSource === "unknown" ? "播出进度暂未确认，等待元数据更新" : `已播出 ${target.season.latestAiredEpisode} / ${target.season.totalEpisodes} 集`}</p>
          {status ? <div className="episode-grid hub-episode-grid" aria-label="条目集数状态">{status.episodes.map((episode) => (
            <div key={episode.episodeCode} className={`episode-cell ${episode.displayState.replaceAll("_", "-")}`}
              title={`${episode.episodeCode} · ${LABELS[episode.displayState]}`}>
              <strong>{episode.episodeCode.replace(/^S01/, "")}</strong><span>{LABELS[episode.displayState]}</span>
            </div>
          ))}</div> : null}
        </section> : <div className="quiet-state"><strong>{unavailable}</strong><Link href={back}>返回搜索</Link></div>}
        <GitHubNameplate />
      </main>
    </div>
  );
}
