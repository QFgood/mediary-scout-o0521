import { randomUUID } from "node:crypto";
import { createEpisodeStates, type MediaTitle, type MediaType, type TrackedSeason } from "./domain.js";
import { syncSeasonAgainstMetadata } from "./season-sync.js";
import { episodeCodeFromFileName } from "./episode-code.js";
import type { StorageExecutor } from "./ports.js";
import type { WorkflowRepository } from "./repository.js";
import type { WorkflowScope } from "./workflow-scope.js";

export interface LibrarySyncReport {
  imported: number; existing: number; episodes: number; updated: number; queued: number; missingEpisodes: number;
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

/** Recognize legacy numeric names only inside an identified season directory.
 * Never use this for arbitrary resource search results or infer season from a bare number. */
export function libraryEpisodeCode(name: string, seasonNumber: number, totalEpisodes: number): string | null {
  const basename = name.split("/").at(-1)!;
  const explicit = episodeCodeFromFileName(basename);
  if (explicit) return explicit;
  // Bare numbers inside bonus/pack subfolders have no reliable episode context.
  if (name.includes("/")) return null;
  const match = /^(\d{1,4})\.(?:mkv|mp4|avi|mov|m4v|ts|m2ts|wmv|flv|webm)$/i.exec(basename);
  if (!match) return null;
  const episode = Number(match[1]);
  if (episode < 1 || totalEpisodes < 1 || episode > totalEpisodes) return null;
  return `S${String(seasonNumber).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/** Read the original library directories, restore/reconcile verified obtained facts,
 * then queue missing aired episodes through the existing worker. */
export async function syncLibraryFromDrive(input: {
  storage: Pick<StorageExecutor, "listChildDirectories" | "listTree">;
  repository: WorkflowRepository;
  scope: WorkflowScope;
  categories: Array<{ id: string; type: MediaType }>;
  resolveTarget(folder: LibraryFolderIdentity, seasonNumber: number): Promise<{ title: MediaTitle; season: TrackedSeason }>;
  now?: () => string;
  queueMissing?: boolean;
}): Promise<LibrarySyncReport> {
  const report: LibrarySyncReport = { imported: 0, existing: 0, episodes: 0, updated: 0, queued: 0, missingEpisodes: 0, issues: [] };
  const issue = (name: string, reason: string) => report.issues.push({ name, reason });
  const existing = await input.repository.listTrackedSeasonStates(input.scope);
  const eligible = new Set<string>();
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
          try {
            const files = (await input.storage.listTree({ directoryId: dir.id, maxDepth: 4 })).filter((f) => f.sizeBytes > 0 && isVideo(f.path));
            if (!files.length) { issue(label, "未发现有效视频文件，已跳过。"); continue; }
            const stored = existing.find((s) => s.season.storageDirectoryId === dir.id);
            // Existing identity is authoritative; a metadata outage must not prevent
            // repairing obtained marks on a previously identified season.
            let metadataUnavailable = false;
            let target: { title: MediaTitle; season: TrackedSeason };
            try {
              target = await input.resolveTarget(identity, dir.number);
              if (stored && (target.title.id !== stored.title.id || target.season.id !== stored.season.id)) throw new Error("identity mismatch");
            } catch {
              if (!stored) throw new Error("metadata unavailable");
              target = { title: stored.title, season: stored.season }; metadataUnavailable = true;
              issue(label, "元数据未能刷新，仍修复已确认的入库集号，本次不自动补集。");
            }
            const current = stored ?? existing.find((s) => s.season.id === target.season.id);
            if (current && current.season.storageDirectoryId !== dir.id) { report.existing++; issue(label, "同季度已关联其他目录，请先核对，未合并或提交补集。"); continue; }
            let ambiguous = false;
            const byEpisode = new Map<string, string[]>();
            for (const file of files) {
              const code = category.type === "movie" ? "S01E01" : libraryEpisodeCode(file.path, dir.number, target.season.totalEpisodes);
              if (!code || Number(/^S(\d+)/.exec(code)?.[1]) !== dir.number) { ambiguous = true; issue(`${label}/${file.path}`, "文件名集号不明或与季度目录不一致，已跳过。"); continue; }
              const ids = byEpisode.get(code) ?? []; ids.push(file.providerFileId); byEpisode.set(code, ids);
            }
            if (!byEpisode.size) { issue(label, "没有可确认归属的视频，未创建记录。"); continue; }
            const at = (input.now ?? (() => new Date().toISOString()))();
            const reservation = await input.repository.reserveWorkflowRun({
              ...input.scope, ...target, episodes: [],
              workflowRun: { id: `library_sync_${randomUUID()}`, kind: "type3_monitor", status: "running", trackedSeasonId: target.season.id, startedAt: at, finishedAt: null, auditEvents: [] },
              resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [],
              blockIfTitleHasActiveRun: true,
              ...(current ? { keepCurrentEpisodes: true, requireTrackedSeason: true } : { blockIfEpisodeStatesExist: true }),
            });
            if (reservation.status !== "reserved") { report.existing++; issue(label, "作品正在获取、已取消或状态已变化，暂缓复核与补集。"); continue; }
            try {
              const latest = reservation.snapshot;
              const synced = current ? syncSeasonAgainstMetadata({ season: latest.season, episodes: structuredClone(latest.episodes),
                latestAiredEpisode: target.season.latestAiredEpisode, totalEpisodes: target.season.totalEpisodes }) : null;
              const season = { ...(synced?.season ?? latest.season), storageDirectoryId: dir.id };
              const episodes = synced?.episodes ?? createEpisodeStates({ trackedSeasonId: season.id, seasonNumber: season.seasonNumber, totalEpisodes: season.totalEpisodes, latestAiredEpisode: season.latestAiredEpisode });
              let recovered = 0;
              for (const [code, ids] of byEpisode) {
                let episode = episodes.find((e) => e.episodeCode === code);
                if (!episode) { episode = { trackedSeasonId: season.id, episodeCode: code, airDate: null, title: code, airStatus: "unknown", metadataStatus: "storage_only", obtained: false, verifiedFileIds: [] }; episodes.push(episode); }
                if (!episode.obtained) recovered++;
                episode.obtained = true; episode.verifiedFileIds = [...new Set(ids)];
              }
              // Add confirmed facts, without erasing prior obtained marks based on
              // a bounded tree scan. Unrecognized videos block automatic refill.
              if (category.type !== "movie") season.status = season.totalEpisodes > 0 && season.latestAiredEpisode >= season.totalEpisodes &&
                episodes.filter((e) => e.metadataStatus !== "storage_only").every((e) => e.obtained) ? "completed" : "active";
              await input.repository.saveWorkflowRunSnapshot({
                ...latest, season, episodes,
                workflowRun: { ...latest.workflowRun, status: "succeeded", finishedAt: at,
                  auditEvents: [{ type: "library_drive_sync", message: "复核网盘已有文件并更新入库集号，未修改网盘文件。", data: { directoryId: dir.id, files: byEpisode.size } }] },
                requireTrackedSeason: true,
              });
              if (current) { report.existing++; if (recovered) report.updated++; } else report.imported++;
              report.episodes += recovered;
              if (!ambiguous && !metadataUnavailable && category.type !== "movie") eligible.add(season.id);
              else if (ambiguous) issue(label, "存在未识别视频，已恢复可确认的集数；为避免重复获取，本次不自动补集。");
            } catch (error) {
              await input.repository.saveWorkflowRunSnapshot({ ...reservation.snapshot, keepCurrentEpisodes: true, requireTrackedSeason: true,
                workflowRun: { ...reservation.snapshot.workflowRun, status: "failed", finishedAt: at } });
              throw error;
            }
          } catch { issue(label, "读取文件、获取元数据或保存记录失败；已有记录保留，可稍后重试。"); }
        }
      } catch { issue(folder.name, "无法读取作品目录，请稍后重试。"); }
    }
  }
  if (input.queueMissing !== false) {
    for (const seasonId of eligible) {
      const state = await input.repository.getTrackedSeasonState(seasonId, input.scope);
      if (!state) continue;
      const missing = state.episodes.filter((e) => e.airStatus === "aired" && !e.obtained && e.metadataStatus !== "storage_only");
      report.missingEpisodes += missing.length;
      if (!missing.length) continue;
      const at = (input.now ?? (() => new Date().toISOString()))();
      const reserved = await input.repository.reserveWorkflowRun({
        ...state, ...input.scope,
        workflowRun: { id: `library_refill_${randomUUID()}`, kind: "type2_init", status: "queued", trackedSeasonId: seasonId, startedAt: at, finishedAt: null,
          auditEvents: [{ type: "library_refill_queued", message: "网盘同步后自动补充已播缺集。", data: { episodes: missing.map((e) => e.episodeCode) } }] },
        resourceSnapshots: [], decisions: [], transferAttempts: [], notifications: [],
        keepCurrentEpisodes: true, requireTrackedSeason: true, blockIfTitleHasActiveRun: true,
      });
      if (reserved.status === "reserved") report.queued++;
      else issue(state.title.title, "已有活动任务或追踪已取消，本次未重复提交补集；可稍后重试。");
    }
  }
  return report;
}
