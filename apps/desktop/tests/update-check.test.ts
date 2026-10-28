import { describe, expect, it } from "vitest";
import {
  decideUpdateNotice,
  parseLatestRelease,
  shouldCheckForUpdate,
  UPDATE_CHECK_INTERVAL_MS,
  RELEASES_LATEST_URL,
} from "../src/update-check.js";

const PAGE = "https://github.com/QFgood/mediary-scout-o0521/releases/tag/v2026.10.02";
const DOWNLOAD = "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02";
const asset = (name: string, url = `${DOWNLOAD}/${name}`) => ({ name, browser_download_url: url });

describe("parseLatestRelease", () => {
  it("checks this fork and rejects the original project's installer URLs", () => {
    expect(RELEASES_LATEST_URL).toBe("https://api.github.com/repos/QFgood/mediary-scout-o0521/releases/latest");
    expect(parseLatestRelease({ tag_name: "v2026.10.28", assets: [
      asset("a.dmg", "https://github.com/fancydirty/mediary-scout/releases/download/v2026.10.28/a.dmg"),
      asset("a.exe", "https://github.com/fancydirty/mediary-scout/releases/download/v2026.10.28/a.exe"),
    ] })).toBeNull();
  });
  it("reads a date release that has both installers and links its release page on GitHub", () => {
    expect(
      parseLatestRelease({
        tag_name: "v2026.10.02",
        html_url: "https://elsewhere.example/x",
        assets: [asset("Mediary.Scout-2026.1002.0-arm64.dmg"), asset("Mediary.Scout.Setup.2026.1002.0.exe")],
      }),
    ).toEqual({
      tag: "v2026.10.02",
      version: "2026.1002.0",
      pageUrl: PAGE,
    });
  });

  it("ignores a date release until both installers are on this repo's download URL", () => {
    expect(parseLatestRelease({ tag_name: "v2026.10.02", assets: [] })).toBeNull();
    expect(parseLatestRelease({ tag_name: "v2026.10.02", assets: [asset("a.dmg")] })).toBeNull();
    expect(parseLatestRelease({ tag_name: "v2026.10.02", assets: [asset("a.exe")] })).toBeNull();
    expect(
      parseLatestRelease({
        tag_name: "v2026.10.02",
        assets: [asset("a.dmg", "https://elsewhere.example/a.dmg"), asset("a.exe", "https://elsewhere.example/a.exe")],
      }),
    ).toBeNull();
  });

  it("ignores anything that is not a date release", () => {
    for (const body of [{ tag_name: "v1.4.1" }, { tag_name: 42 }, {}, null, "v2026.10.02"]) {
      expect(parseLatestRelease(body)).toBeNull();
    }
  });
});

describe("decideUpdateNotice", () => {
  const latest = { tag: "v2026.10.02", version: "2026.1002.0", pageUrl: PAGE };

  it("offers a newer release, and notifies once per release", () => {
    expect(decideUpdateNotice({ latest, currentVersion: "2026.928.0", notifiedTag: null })).toEqual({
      offer: latest,
      notify: true,
    });
    expect(decideUpdateNotice({ latest, currentVersion: "2026.928.0", notifiedTag: "v2026.10.02" })).toEqual({
      offer: latest,
      notify: false,
    });
    expect(decideUpdateNotice({ latest, currentVersion: "2026.928.0", notifiedTag: "v2026.09.30" }).notify).toBe(true);
  });

  it("never offers the running release or an older one", () => {
    const none = { offer: null, notify: false };
    expect(decideUpdateNotice({ latest, currentVersion: "2026.1002.0", notifiedTag: null })).toEqual(none);
    expect(decideUpdateNotice({ latest, currentVersion: "2026.1015.0", notifiedTag: null })).toEqual(none);
    expect(decideUpdateNotice({ latest: null, currentVersion: "2026.928.0", notifiedTag: null })).toEqual(none);
  });

  it("offers the first date release to a 1.x install", () => {
    expect(decideUpdateNotice({ latest, currentVersion: "1.4.1", notifiedTag: null }).offer).toBe(latest);
  });
});

describe("shouldCheckForUpdate", () => {
  const start = Date.UTC(2026, 9, 1);

  it("checks when it never has, then once a day of wall-clock time has passed", () => {
    expect(shouldCheckForUpdate({ now: start, lastCheckedAt: null })).toBe(true);
    expect(shouldCheckForUpdate({ now: start + UPDATE_CHECK_INTERVAL_MS - 1, lastCheckedAt: start })).toBe(false);
    expect(shouldCheckForUpdate({ now: start + UPDATE_CHECK_INTERVAL_MS, lastCheckedAt: start })).toBe(true);
  });

  it("checks again when the clock went backwards", () => {
    expect(shouldCheckForUpdate({ now: start - 1000, lastCheckedAt: start })).toBe(true);
  });
});
