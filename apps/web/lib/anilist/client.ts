import { z } from "zod";
import { AniListCache } from "./cache";
import { mapAniListMedia, type AniListMetadata } from "./mapper";
import { DEFAULT_ANILIST_API_URL, normalizeAniListApiUrl } from "./config";

const MINUTE = 60_000;
const FIELDS = `id type isAdult countryOfOrigin title { native romaji english } synonyms
  description coverImage { large } startDate { year month day } seasonYear season episodes format status popularity
  nextAiringEpisode { episode airingAt }`;
const envelope = z.object({ data: z.unknown().optional(), errors: z.array(z.unknown()).optional() });
export type AnimeFeed = "season" | "trending" | "upcoming";

export function currentAnimeSeason(now: Date): { season: string; seasonYear: number } {
  return { season: ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(now.getUTCMonth() / 3)]!, seasonYear: now.getUTCFullYear() };
}

export class AniListClient {
  private readonly cache: AniListCache;
  private retryAfter = 0;
  private readonly endpoint: string;

  constructor(private readonly options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number; endpoint?: string } = {}) {
    this.cache = new AniListCache(options.now);
    this.endpoint = normalizeAniListApiUrl(options.endpoint ?? DEFAULT_ANILIST_API_URL);
  }

  private async request(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const now = this.options.now ?? Date.now;
    if (now() < this.retryAfter) throw new Error("AniList 请求频率受限，请稍后重试。");
    const response = await (this.options.fetch ?? fetch)(this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
      cache: "no-store",
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      this.retryAfter = now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 60) * 1_000;
    }
    if (!response.ok) throw new Error(`AniList HTTP ${response.status}`);
    const parsed = envelope.parse(await response.json());
    if (parsed.errors?.length || !parsed.data) throw new Error("AniList 返回了不完整的元数据，请稍后重试。");
    return parsed.data;
  }

  private async list(query: string, variables: Record<string, unknown>): Promise<AniListMetadata[]> {
    const data = z.object({ Page: z.object({ media: z.array(z.unknown()) }) }).parse(await this.request(query, variables));
    return data.Page.media.map(mapAniListMedia).filter((media): media is AniListMetadata => media !== null);
  }

  async search(query: string): Promise<AniListMetadata[]> {
    const search = query.trim().replace(/\s+/g, " ").slice(0, 200);
    if (!search) return [];
    return this.cache.load(`search:${search}`, 15 * MINUTE, () => this.list(
      `query ($search: String!) { Page(page: 1, perPage: 30) { media(search: $search, type: ANIME, isAdult: false, countryOfOrigin: "JP", sort: SEARCH_MATCH) { ${FIELDS} } } }`,
      { search },
    ));
  }

  async details(id: number): Promise<AniListMetadata | null> {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("AniList ID 无效。");
    return this.cache.load(`details:${id}`, 60 * MINUTE, async () => {
      const data = z.object({ Media: z.unknown().nullable() }).parse(await this.request(
        `query ($id: Int!) { Media(id: $id, type: ANIME, isAdult: false) { ${FIELDS} airingSchedule(notYetAired: false, perPage: 50) { nodes { episode airingAt } } } }`, { id },
      ));
      if (data.Media === null) return null;
      const media = mapAniListMedia(data.Media);
      if (!media || media.anilistId !== id) throw new Error("AniList 作品元数据无效或不受支持。");
      return media;
    });
  }

  async trending(feed: AnimeFeed): Promise<AniListMetadata[]> {
    const current = currentAnimeSeason(new Date((this.options.now ?? Date.now)()));
    const variables = feed === "season" ? current : {};
    const declaration = feed === "season" ? "($season: MediaSeason!, $seasonYear: Int!)" : "";
    const filter = feed === "season" ? "season: $season, seasonYear: $seasonYear," : feed === "upcoming" ? "status: NOT_YET_RELEASED," : "";
    return this.cache.load(`feed:${feed}:${current.seasonYear}:${current.season}`, 12 * 60 * MINUTE,
      async () => {
        const media = await this.list(`query ${declaration} { Page(page: 1, perPage: 12) { media(type: ANIME, isAdult: false, countryOfOrigin: "JP", ${filter} sort: TRENDING_DESC) { ${FIELDS} } } }`, variables);
        if (!media.length) throw new Error("AniList 榜单暂时为空。");
        return media;
      }, 7 * 24 * 60 * MINUTE);
  }
}

export const anilistClient = new AniListClient();
