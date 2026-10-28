import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdaterStatus } from "./updater-client";

vi.mock("./deployment-update-server", () => ({ readBuildCommit: vi.fn() }));
vi.mock("./release-feed-server", () => ({
  fetchReleaseFeed: vi.fn(),
  fetchCommitRelation: vi.fn(),
  fetchLatestDesktopRelease: vi.fn(),
}));
vi.mock("./updater-client", async () => {
  const actual = await vi.importActual<typeof import("./updater-client")>("./updater-client");
  return { ...actual, getUpdaterStatus: vi.fn(), isUpdaterInstalled: vi.fn(async () => false) };
});
vi.mock("./workflow-runtime", () => ({
  resolveIsDesktop: vi.fn(() => false),
}));

import { readBuildCommit } from "./deployment-update-server";
import { fetchCommitRelation, fetchLatestDesktopRelease, fetchReleaseFeed } from "./release-feed-server";
import { loadUpdateView } from "./update-view-server";
import { getUpdaterStatus, isUpdaterInstalled } from "./updater-client";
import { resolveIsDesktop } from "./workflow-runtime";

const feed = [
  { tag: "v2026.10.02", date: "2026-10-02", commit: "c".repeat(40), notes: [] },
  { tag: "v2026.09.28", date: "2026-09-28", commit: "b".repeat(40), notes: [] },
];
const published = {
  tag: "v2026.10.02",
  pageUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/tag/v2026.10.02",
  dmgUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02/a.dmg",
  exeUrl: "https://github.com/QFgood/mediary-scout-o0521/releases/download/v2026.10.02/a.exe",
};
const idle: UpdaterStatus = {
  phase: "idle",
  targetTag: null,
  fromCommit: null,
  startedAt: null,
  finishedAt: null,
  message: "",
  logTail: "",
  repoCommit: "d".repeat(40),
};

describe("loadUpdateView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveIsDesktop).mockReturnValue(false);
    vi.mocked(readBuildCommit).mockResolvedValue("b".repeat(40));
    vi.mocked(fetchReleaseFeed).mockResolvedValue(feed);
    vi.mocked(fetchCommitRelation).mockResolvedValue(null);
    vi.mocked(fetchLatestDesktopRelease).mockResolvedValue(null);
    vi.mocked(getUpdaterStatus).mockResolvedValue(idle);
  });

  it("does not ask the updater on desktop, and still offers the published installer", async () => {
    vi.mocked(resolveIsDesktop).mockReturnValue(true);
    vi.mocked(fetchLatestDesktopRelease).mockResolvedValue(published);
    const view = await loadUpdateView();
    expect(getUpdaterStatus).not.toHaveBeenCalled();
    expect(view.updater).toBeNull();
    expect(view.download).not.toBeNull();
    expect(view.available?.tag).toBe("v2026.10.02");
  });

  it("does not fall back to the updater commit when a desktop build has no stamp", async () => {
    vi.mocked(resolveIsDesktop).mockReturnValue(true);
    vi.mocked(readBuildCommit).mockResolvedValue(null);
    vi.mocked(fetchLatestDesktopRelease).mockResolvedValue(null);
    const view = await loadUpdateView();
    expect(getUpdaterStatus).not.toHaveBeenCalled();
    expect(view.updater).toBeNull();
    expect(view.current.label).toBe("未知版本");
  });

  it("does not ask GitHub for a desktop release on Docker", async () => {
    const view = await loadUpdateView();
    expect(fetchLatestDesktopRelease).not.toHaveBeenCalled();
    expect(getUpdaterStatus).toHaveBeenCalledTimes(1);
    expect(view.available?.tag).toBe("v2026.10.02");
    expect(view.updater).toBe(idle);
  });

  it("skips the updater status when the caller asks, and still uses a stamped commit", async () => {
    const view = await loadUpdateView({ updaterStatus: false });
    expect(getUpdaterStatus).not.toHaveBeenCalled();
    expect(view.updater).toBeNull();
    expect(view.available?.tag).toBe("v2026.10.02");
  });

  it("reuses the commit from the status it already fetched instead of asking again", async () => {
    const older = "d".repeat(40);
    vi.mocked(readBuildCommit).mockResolvedValue(null);
    vi.mocked(getUpdaterStatus).mockResolvedValue({ ...idle, repoCommit: older });
    vi.mocked(fetchCommitRelation).mockResolvedValue("behind");
    const view = await loadUpdateView();
    expect(getUpdaterStatus).toHaveBeenCalledTimes(1);
    expect(view.current.label).toBe("dddddddd · 开发版本");
  });

  it("does not reach the updater for the deploy folder commit either when asked not to", async () => {
    vi.mocked(readBuildCommit).mockResolvedValue(null);
    const view = await loadUpdateView({ updaterStatus: false });
    expect(getUpdaterStatus).not.toHaveBeenCalled();
    expect(view.current.label).toBe("未知版本");
  });

  it("uses the deploy folder commit when the image has none, and offers a release it is behind", async () => {
    const older = "d".repeat(40);
    vi.mocked(readBuildCommit).mockResolvedValue(null);
    vi.mocked(getUpdaterStatus).mockResolvedValue({ ...idle, repoCommit: older });
    vi.mocked(fetchCommitRelation).mockResolvedValue("behind");
    const view = await loadUpdateView();
    expect(fetchCommitRelation).toHaveBeenCalledWith("c".repeat(40), older);
    expect(view.available?.tag).toBe("v2026.10.02");
    expect(view.current.label).toBe("dddddddd · 开发版本");
  });

  it("tells an installed updater that did not answer apart from no updater at all", async () => {
    vi.mocked(getUpdaterStatus).mockResolvedValue(null);
    vi.mocked(isUpdaterInstalled).mockResolvedValue(true);
    expect((await loadUpdateView()).updaterInstalled).toBe(true);
    vi.mocked(isUpdaterInstalled).mockResolvedValue(false);
    expect((await loadUpdateView()).updaterInstalled).toBe(false);
    vi.mocked(resolveIsDesktop).mockReturnValue(true);
    vi.mocked(isUpdaterInstalled).mockResolvedValue(true);
    expect((await loadUpdateView()).updaterInstalled).toBe(false);
  });

  it("does not report the deploy folder commit as serving while an update runs or a checkout is pending", async () => {
    vi.mocked(readBuildCommit).mockResolvedValue(null);
    for (const status of [
      { ...idle, phase: "building" as const, repoCommit: "c".repeat(40) },
      { ...idle, phase: "failed" as const, repoCommit: "c".repeat(40), pendingRestore: true },
    ]) {
      vi.mocked(getUpdaterStatus).mockResolvedValue(status);
      const view = await loadUpdateView();
      expect(view.current.label).toBe("未知版本");
      expect(view.current.tag).toBeNull();
    }
  });
});
