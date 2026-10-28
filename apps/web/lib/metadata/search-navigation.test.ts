import { describe, expect, it } from "vitest";
import { lastQueryKey } from "@media-track/workflow/scope";
import { rememberedSearchHref } from "./search-navigation";

describe("per-drive metadata search restoration", () => {
  it("restores each drive's own source and query", () => {
    const values = new Map([
      [lastQueryKey("/"), "Movie"], [`${lastQueryKey("/")}:source`, "tmdb"],
      [lastQueryKey("/w/quark"), "薬屋 & 三"], [`${lastQueryKey("/w/quark")}:source`, "anilist"],
    ]);
    const read = (key: string) => values.get(key) ?? null;
    const url = new URL(rememberedSearchHref("/w/quark", read)!, "http://localhost");
    expect(url.pathname).toBe("/w/quark");
    expect(url.searchParams.get("q")).toBe("薬屋 & 三");
    expect(url.searchParams.get("source")).toBe("anilist");
    expect(rememberedSearchHref("/", read)).toContain("source=tmdb");
  });

  it("retains the AniList source even when its remembered query is empty", () => {
    const href = rememberedSearchHref("/w/quark", (key) => key.endsWith(":source") ? "anilist" : "");
    expect(href).toBe("/w/quark?tab=search&q=&source=anilist");
  });

  it("uses TMDB for legacy query-only memory", () => {
    const href = rememberedSearchHref("/", (key) => key === lastQueryKey("/") ? "Title" : null);
    expect(href).toBe("/?tab=search&q=Title&source=tmdb");
  });

  it("leaves default navigation intact with missing or blocked storage", () => {
    expect(rememberedSearchHref("/", () => null)).toBeNull();
    expect(rememberedSearchHref("/", () => { throw new Error("storage disabled"); })).toBeNull();
  });
});
