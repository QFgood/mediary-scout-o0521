import { AniListCache, type CacheResult } from "./cache";
import { isRecord, mapAniListMedia, type AniListMedia } from "./mapper";

const ENDPOINT = "https://graphql.anilist.co";
const HOUR = 60 * 60 * 1000;
const FIELDS = `id type isAdult title { native romaji english } synonyms format status
  episodes season seasonYear startDate { year } popularity description(asHtml: false)
  coverImage { extraLarge large } nextAiringEpisode { episode }`;
const SEARCH_QUERY = `query ScoutAnimeSearch($search: String!) {
  Page(page: 1, perPage: 20) {
    media(search: $search, type: ANIME, countryOfOrigin: "JP", isAdult: false, sort: SEARCH_MATCH) { ${FIELDS} }
  }
}`;
const DETAILS_QUERY = `query ScoutAnimeDetails($id: Int!) {
  Media(id: $id, type: ANIME, isAdult: false) {
    ${FIELDS}
    relations { edges { relationType node { id type title { native romaji english } } } }
  }
}`;
export type AniListFeed = "season" | "trending" | "upcoming";

export function broadcastPeriod(now: Date): { season: string; seasonYear: number } {
  return { season: ["WINTER", "SPRING", "SUMMER", "FALL"][Math.floor(now.getUTCMonth() / 3)]!, seasonYear: now.getUTCFullYear() };
}

export class AniListClient {
  private readonly fetcher: typeof fetch;
  private readonly cache: AniListCache;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private retryAt = 0;

  constructor(options: { fetcher?: typeof fetch; now?: () => number; timeoutMs?: number; cache?: AniListCache } = {}) {
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.now = options.now ?? Date.now;
    this.cache = options.cache ?? new AniListCache(this.now);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async search(query: string): Promise<CacheResult<AniListMedia[]>> {
    const search = query.trim().replace(/\s+/g, " ");
    if (!search) return { value: [], status: "miss" };
    if (search.length > 200) throw new Error("搜索关键词请控制在 200 个字符以内。");
    return this.cache.load(`search:${search.toLowerCase()}`, 6 * HOUR, 0, async () =>
      this.mediaPage(await this.request(SEARCH_QUERY, { search })),
    );
  }

  async details(id: number): Promise<CacheResult<AniListMedia | null>> {
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) throw new Error("AniList 作品编号无效。");
    return this.cache.load(`details:${id}`, 24 * HOUR, 0, async () => {
      const data = await this.request(DETAILS_QUERY, { id });
      if (!("Media" in data)) throw new Error("AniList 返回了无效的作品详情。");
      if (data.Media === null) return null;
      const media = mapAniListMedia(data.Media);
      if (!media) throw new Error("AniList 返回了无效的作品详情。");
      return media;
    });
  }

  async trending(feed: AniListFeed = "trending"): Promise<CacheResult<AniListMedia[]>> {
    const period = broadcastPeriod(new Date(this.now()));
    const filter = feed === "season"
      ? ", season: $season, seasonYear: $seasonYear, sort: POPULARITY_DESC"
      : feed === "upcoming" ? ", status: NOT_YET_RELEASED, sort: POPULARITY_DESC"
      : ", startDate_greater: $since, sort: TRENDING_DESC";
    const variables: Record<string, unknown> = feed === "season" ? period
      : feed === "trending" ? { since: (period.seasonYear - 1) * 10000 + 101 } : {};
    const declarations = feed === "season" ? "($season: MediaSeason!, $seasonYear: Int!)"
      : feed === "trending" ? "($since: FuzzyDateInt!)" : "";
    const query = `query ScoutAnimeFeed${declarations} {
      Page(page: 1, perPage: 12) {
        media(type: ANIME, countryOfOrigin: "JP", isAdult: false${filter}) { ${FIELDS} }
      }
    }`;
    return this.cache.load(`feed:${feed}:${JSON.stringify(variables)}`, 12 * HOUR, 7 * 24 * HOUR,
      async () => this.mediaPage(await this.request(query, variables)));
  }

  private mediaPage(data: Record<string, unknown>): AniListMedia[] {
    if (!isRecord(data.Page) || !Array.isArray(data.Page.media)) throw new Error("AniList 返回了无效的列表。");
    return data.Page.media.map(mapAniListMedia).filter((media): media is AniListMedia => media !== null);
  }

  private async request(query: string, variables: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.retryAt > this.now()) throw new Error("AniList 请求频率受限，请稍后重试。");
    const response = await this.fetcher(ENDPOINT, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }), cache: "no-store", signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const seconds = raw === null ? 60 : Number(raw);
      const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw!) - this.now();
      this.retryAt = this.now() + Math.max(1000, Number.isFinite(wait) ? wait : 60_000);
      throw new Error("AniList 请求频率受限，请稍后重试。");
    }
    if (!response.ok) throw new Error(`AniList 服务暂时不可用（HTTP ${response.status}）。`);
    const body: unknown = await response.json();
    if (!isRecord(body) || (Array.isArray(body.errors) && body.errors.length > 0) || !isRecord(body.data)) {
      throw new Error("AniList 未返回完整元数据，请稍后重试。");
    }
    return body.data;
  }
}

export const anilistClient = new AniListClient();
