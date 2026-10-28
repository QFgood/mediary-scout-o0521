import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceNotFoundError } from "@media-track/workflow";
import { AppSidebar } from "../../../../components/app-sidebar";
import { AniListError, AniListMediaCard } from "../../../../components/anilist-results";
import { anilistClient } from "../../../../lib/anilist/client";
import { getActiveWorkspaceScope } from "../../../../lib/workflow-runtime";
import { metadataSearchHref } from "../../../../lib/metadata/types";

type Props = {
  params: Promise<{ anilistId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function AniListDetailPage(props: Props) {
  return <Suspense fallback={<div className="app-shell" />}><AniListDetail {...props} /></Suspense>;
}

async function AniListDetail({ params, searchParams }: Props) {
  const { anilistId } = await params;
  const id = Number(anilistId);
  if (!/^\d+$/.test(anilistId) || !Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) notFound();
  const search = await searchParams;
  const storageId = typeof search.w === "string" ? search.w : undefined;
  try {
    await getActiveWorkspaceScope(storageId);
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) notFound();
    throw error;
  }
  const basePath = storageId ? `/w/${storageId}` : "/";
  let result;
  try {
    result = await anilistClient.details(id);
  } catch {
    return <div className="app-shell"><AppSidebar active="search" basePath={basePath} activeStorageId={storageId} />
      <main className="main product-main"><AniListError retryHref={`/anime/anilist/${id}${storageId ? `?${new URLSearchParams({ w: storageId })}` : ""}`} /></main></div>;
  }
  if (!result.value) notFound();
  return (
    <div className="app-shell">
      <AppSidebar active="search" basePath={basePath} activeStorageId={storageId} searchQuery={result.value.title} searchSource="anilist" />
      <main className="main product-main">
        <Link className="filter-pill" href={metadataSearchHref(basePath, result.value.title, "anilist")}>返回 AniList 搜索</Link>
        <section className="search-results" aria-label="AniList 作品详情">
          <AniListMediaCard media={result.value} basePath={basePath} storageId={storageId} details />
        </section>
      </main>
    </div>
  );
}
