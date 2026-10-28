import { describe, expect, it } from "vitest";
import { buildUpdateView, desktopDownload, desktopFeed, desktopView } from "./update-state";

const feed = [
  { tag: "v2026.10.02", date: "2026-10-02", commit: "c".repeat(40), notes: [] },
  { tag: "v2026.09.28", date: "2026-09-28", commit: "b".repeat(40), notes: [] },
];
const base = { feed, updater: null, relation: null };

describe("buildUpdateView", () => {
  it("names the current release and offers the newer one", () => {
    const view = buildUpdateView({ ...base, currentCommit: "b".repeat(40) });
    expect(view.current).toEqual({ label: "v2026.09.28", tag: "v2026.09.28" });
    expect(view.available?.tag).toBe("v2026.10.02");
    expect(view.releases.map((r) => [r.tag, r.isCurrent])).toEqual([
      ["v2026.10.02", false],
      ["v2026.09.28", true],
    ]);
    expect(view.download).toBeNull();
  });
  it("is up to date on the newest release", () => {
    const view = buildUpdateView({ ...base, currentCommit: "c".repeat(40) });
    expect(view.available).toBeNull();
    expect(view.status).toBe("latest");
  });
  it("offers the newest release to an untagged build only when that build is behind it", () => {
    const behind = buildUpdateView({ ...base, currentCommit: "d".repeat(40), relation: "behind" });
    expect(behind.current).toEqual({ label: "dddddddd · 开发版本", tag: null });
    expect(behind.available?.tag).toBe("v2026.10.02");
    expect(behind.status).toBe("available");
    for (const relation of ["ahead", "identical", "diverged", null] as const) {
      expect(buildUpdateView({ ...base, currentCommit: "d".repeat(40), relation }).available).toBeNull();
    }
  });
  it("only claims 已是最新 when the comparison was actually made", () => {
    const status = (relation: "ahead" | "identical" | "diverged" | null) =>
      buildUpdateView({ ...base, currentCommit: "d".repeat(40), relation }).status;
    expect(status("ahead")).toBe("latest");
    expect(status("identical")).toBe("latest");
    expect(status("diverged")).toBe("unknown");
    expect(status(null)).toBe("unknown");
  });
  it("says so when an untagged build is newer than the newest release", () => {
    const view = buildUpdateView({ ...base, currentCommit: "d".repeat(40), relation: "ahead" });
    expect(view.current.label).toBe("dddddddd · 比 v2026.10.02 新的开发版本");
  });
  it("calls a build with no stamped commit 未知版本 and offers nothing", () => {
    const view = buildUpdateView({ ...base, currentCommit: null });
    expect(view.current).toEqual({ label: "未知版本", tag: null });
    expect(view.available).toBeNull();
    expect(view.status).toBe("unknown");
  });
  it("offers nothing when the feed is empty (offline), and does not call the build a dev build", () => {
    const view = buildUpdateView({ ...base, currentCommit: "d".repeat(40), feed: [] });
    expect(view.available).toBeNull();
    expect(view.status).toBe("offline");
    // Without the release list we cannot tell a release from a dev build.
    expect(view.current).toEqual({ label: "dddddddd", tag: null });
  });
});

describe("desktopFeed", () => {
  it("keeps only releases up to the latest one published with installers", () => {
    expect(desktopFeed(feed, "v2026.09.28").map((r) => r.tag)).toEqual(["v2026.09.28"]);
    expect(desktopFeed(feed, "v2026.10.02").map((r) => r.tag)).toEqual(["v2026.10.02", "v2026.09.28"]);
    expect(desktopFeed(feed, null)).toEqual([]);
  });

  it("so a tag whose installers are not out yet is neither offered nor listed", () => {
    const view = buildUpdateView({ ...base, feed: desktopFeed(feed, "v2026.09.28"), currentCommit: "b".repeat(40) });
    expect(view.available).toBeNull();
    expect(view.status).toBe("latest");
    expect(view.releases.map((r) => r.tag)).toEqual(["v2026.09.28"]);
  });
});

describe("desktopView", () => {
  const published = {
    tag: "v2026.10.02",
    pageUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/tag/v2026.10.02",
    dmgUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02/a.dmg",
    exeUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02/a.exe",
  };

  it("lists the changelog but offers nothing when the published release cannot be read", () => {
    const view = buildUpdateView({ ...base, currentCommit: "b".repeat(40) });
    const settled = desktopView(view, null);
    expect(settled.available).toBeNull();
    expect(settled.status).toBe("unknown");
    expect(settled.releases.map((release) => release.tag)).toEqual(["v2026.10.02", "v2026.09.28"]);
  });

  it("leaves an up-to-date desktop unchanged", () => {
    const view = buildUpdateView({ ...base, currentCommit: "c".repeat(40) });
    expect(view.status).toBe("latest");
    expect(desktopView(view, null)).toBe(view);
  });

  it("leaves the view unchanged when a published release was found", () => {
    const view = buildUpdateView({ ...base, currentCommit: "b".repeat(40) });
    expect(desktopView(view, published)).toBe(view);
  });
});

describe("desktopDownload", () => {
  const release = {
    tag: "v2026.10.02",
    pageUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/tag/v2026.10.02",
    dmgUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02/a.dmg",
    exeUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02/a.exe",
  };

  it("picks this platform's installer", () => {
    expect(desktopDownload(release, "darwin")).toEqual({ url: release.dmgUrl, file: "dmg" });
    expect(desktopDownload(release, "win32")).toEqual({ url: release.exeUrl, file: "exe" });
  });

  it("falls back to the release page", () => {
    expect(desktopDownload({ ...release, dmgUrl: null }, "darwin")).toEqual({ url: release.pageUrl, file: null });
    expect(desktopDownload(release, "linux")).toEqual({ url: release.pageUrl, file: null });
  });
});
