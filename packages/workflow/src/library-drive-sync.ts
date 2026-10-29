import { randomUUID } from "node:crypto";
import { createEpisodeStates, type MediaTitle, type MediaType, type TrackedSeason } from "./domain.js";
import { episodeCodeFromFileName } from "./episode-code.js";
import type { StorageExecutor } from "./ports.js";
import type { WorkflowRepository } from "./repository.js";
import type { WorkflowScope } from "./workflow-scope.js";

export interface LibrarySyncReport {
  imported: number; existing: number; episodes: number;
  issues: Array<{ name: string; reason: string }>;
}
export interface LibraryFolderIdentity {
  name: string; title: string; year: number; category: MediaType;
  source?: "tmdb" | "anilist"; id?: number;
}
export function parseLibraryFolder(name: string, category: MediaType): LibraryFolderIdentity | null {
  const match = /^(.*?)\s*\((\d{4}|—)\)(?:\s*\{(tmdb|anilist)-(\d+)\})?$/.exec(name.trim());
  if (!match || !match[1]?.trim()) return null;
  const id = match[4] ? Number(match[4]) : undefined;
  if (id !== undefined && (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647)) return null;
  if (match[3] === "anilist" && category === "tv") return null;
  return { name, title: match[1].trim(), year: match[2] === "—" ? 0 : Number(match[2]), category,
    ...(id === undefined ? {} : { source: match[3] as "tmdb" | "anilist", id }) };
}
const isVideo = (path: string) => /\.(mkv|mp4|avi|mov|m4v|ts|m2ts|wmv|flv|webm)$/i.test(path) &&
  !path.split("/").some((part) => /staging|^\.|(?:^|[. _-])(sample|trailer)(?:[. _-]|$)|预告|花絮/i.test(part));

/** Restore missing tracking only. The storage port intentionally exposes reads only.
 * Existing records are never overwritten; reservations also protect concurrent jobs. */
export async function syncLibraryFromDrive(input: {
  storage: Pick<StorageExecutor, "listChildDirectories" | "listTree">;
  repository: WorkflowRepository;
  scope: WorkflowScope;
  categories: Array<{ id: string; type: MediaType }>;
  resolveTarget(folder: LibraryFolderIdentity, seasonNumber: number): Promise<{ title: MediaTitle; season: TrackedSeason }>;
  now?: () => string;
}): Promise<LibrarySyncReport> {
  const report: LibrarySyncReport = { imported: 0, existing: 0, episodes: 0, issues: [] };
  const issue = (name: string, reason: string) => report.issues.push({ name, reason });
  const existing = await input.repository.listTrackedSeasonStates(input.scope);
  const knownDirectories = new Set(existing.map((state) => state.season.storageDirectoryId));
  const seen = new Set<string>();
  for (const category of input.categories) {
    let folders: Array<{ id: string; name: string }>;
    try { folders = await input.storage.listChildDirectories(category.id); }
    catch { issue(category.type, "无法读取分类目录，请检查网盘连接后重试。"); continue; }
    for (const folder of folders) {
      if (seen.has(folder.id)) continue;
      seen.add(folder.id);
      const identity = parseLibraryFolder(folder.name, category.type);
      if (!identity) { issue(folder.name, "目录缺少可靠作品标识或标准片名年份，已跳过。"); continue; }
      try {
        const seasonDirs = category.type === "movie" ? [] : (await input.storage.listChildDirectories(folder.id))
          .flatMap((dir) => { const match = /^Season\s+(\d{1,2})$/i.exec(dir.name.trim()); return match && Number(match[1]) > 0 ? [{ ...dir, number: Number(match[1]) }] : []; });
        const directories = category.type === "movie" ? [{ ...folder, number: 1 }] : seasonDirs;
        if (!directories.length) { issue(folder.name, "没有可确认的 Season N 季度目录，已跳过。"); continue; }
        for (const dir of directories) {
          const label = category.type === "movie" ? folder.name : `${folder.name}/${dir.name}`;
          if (knownDirectories.has(dir.id)) { report.existing++; continue; }
          try {
            const files = (await input.storage.listTree({ directoryId: dir.id, maxDepth: 4 })).filter((f) => f.sizeBytes > 0 && isVideo(f.path));
            if (!files.length) { issue(label, "未发现有效视频文件，已跳过。"); continue; }
            const target = await input.resolveTarget(identity, dir.number);
            if (existing.some((s) => s.season.id === target.season.id)) { report.existing++; continue; }
            const byEpisode = new Map<string, string[]>();
            for (const file of files) {
              const code = category.type === "movie" ? "S01E01" : episodeCodeFromFileName(file.path.split("/").at(-1)!);
              if (!code || Number(/^S(\d+)/.exec(code)?.[1]) !== dir.number) { issue(`${label}/${file.path}`, "文件名集号不明或与季度目录不一致，已跳过。"); continue; }
              const ids = byEpisode.get(code) ?? []; ids.push(file.providerFileId); byEpisode.set(code, ids);
            }
            if (!byEpisode.size) { issue(label, "没有可确认归属的视频，未创建记录。"); continue; }
            const season = { ...target.season, storageDirectoryId: dir.id };
            const episodes = createEpisodeStates({ trackedSeasonId: season.id, seasonNumber: season.seasonNumber, totalEpisodes: season.totalEpisodes, latestAiredEpisode: season.latestAiredEpisode });
            for (const [code, ids] of byEpisode) {
              let episode = episodes.find((e) => e.episodeCode === code);
              if (!episode) { episode = { trackedSeasonId: season.id, episodeCode: code, airDate: null, title: code, airStatus: "unknown", metadataStatus: "storage_only", obtained: false, verifiedFileIds: [] }; episodes.push(episode); }
              episode.obtained = true; episode.verifiedFileIds = [...new Set(ids)];
            }
            // Only a fully aired AND fully present season is complete. Partial or
            // still-airing series stay active for normal patrol; nothing is queued.
            if (category.type !== "movie") season.status = season.totalEpisodes > 0 && season.latestAiredEpisode >= season.totalEpisodes &&
              episodes.filter((e) => e.metadataStatus !== "storage_only").every((e) => e.obtained) ? "completed" : "active";
            const at = (input.now ?? (() => new Date().toISOString()))();
            const reserved = await input.repository.reserveWorkflowRun({
              ...input.scope, title: target.title, season, episodes,
              workflowRun: { id: `library_sync_${randomUUID()}`, kind: "type3_monitor", status: "succeeded", trackedSeasonId: season.id, startedAt: at, finishedAt: at,
                auditEvents: [{ type: "library_drive_sync", message: "从网盘已有文件恢复媒体库记录，未转存或修改文件。", data: { directoryId: dir.id, files: byEpisode.size } }] },
              resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [],
              blockIfEpisodeStatesExist: true, blockIfTitleHasActiveRun: true,
            });
            if (reserved.status !== "reserved") { report.existing++; continue; }
            knownDirectories.add(dir.id); existing.push({ ...input.scope, title: target.title, season, episodes });
            report.imported++; report.episodes += byEpisode.size;
          } catch { issue(label, "读取文件、获取元数据或保存记录失败；已有记录保留，可稍后重试。"); }
        }
      } catch { issue(folder.name, "无法读取作品目录，请稍后重试。"); }
    }
  }
  return report;
}
