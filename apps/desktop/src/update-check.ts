import { appVersionFromTag, isNewerAppVersion } from "./release-version.js";

const REPOSITORY = "QFgood/mediary-scout-o0521";
export const RELEASES_LATEST_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
/** Wall-clock time between successful checks. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface LatestRelease {
  tag: string;
  version: string;
  /** The release on GitHub: what changed, and both installers. */
  pageUrl: string;
}

/** Installers are only trusted from this repo's own release downloads. */
const DOWNLOAD_PREFIX = `https://github.com/${REPOSITORY}/releases/download/`;

/** GitHub's releases/latest body → the release, or null when it is not a date release (v1.4.1)
 *  or it does not yet include both a .dmg and an .exe from this repo. The release is created
 *  before the assets finish uploading. The page URL is built from the checked tag, never taken
 *  from the response. */
export function parseLatestRelease(body: unknown): LatestRelease | null {
  if (!body || typeof body !== "object") return null;
  const data = body as { tag_name?: unknown; assets?: unknown };
  const tag = data.tag_name;
  if (typeof tag !== "string") return null;
  const version = appVersionFromTag(tag);
  if (!version) return null;
  if (!hasOwnInstaller(data.assets, ".dmg") || !hasOwnInstaller(data.assets, ".exe")) return null;
  return { tag, version, pageUrl: `https://github.com/${REPOSITORY}/releases/tag/${tag}` };
}

function hasOwnInstaller(assets: unknown, extension: string): boolean {
  if (!Array.isArray(assets)) return false;
  return assets.some((asset) => {
    if (!asset || typeof asset !== "object") return false;
    const item = asset as { name?: unknown; browser_download_url?: unknown };
    return (
      typeof item.name === "string" &&
      item.name.endsWith(extension) &&
      typeof item.browser_download_url === "string" &&
      item.browser_download_url.startsWith(DOWNLOAD_PREFIX)
    );
  });
}

/** Offer only a newer release, and notify once per release. */
export function decideUpdateNotice(input: {
  latest: LatestRelease | null;
  currentVersion: string;
  notifiedTag: string | null;
}): { offer: LatestRelease | null; notify: boolean } {
  const offer = input.latest && isNewerAppVersion(input.latest.version, input.currentVersion) ? input.latest : null;
  return { offer, notify: offer !== null && offer.tag !== input.notifiedTag };
}

/** Due when never checked, a day has passed, or the clock went backwards. */
export function shouldCheckForUpdate(input: { now: number; lastCheckedAt: number | null }): boolean {
  if (input.lastCheckedAt === null) return true;
  return input.now < input.lastCheckedAt || input.now - input.lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
}
