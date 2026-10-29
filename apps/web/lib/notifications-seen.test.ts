import { describe, it, expect, vi } from "vitest";
describe("notification read watermark", () => {
  it("advances monotonically, signals immediate updates, and supports unavailable storage", async () => {
    vi.resetModules(); const values = new Map<string,string>(); const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    try {
      const module = await import("./notifications-seen");
      module.setLastSeen("2026-10-29T12:00:00Z"); module.setLastSeen("2026-10-28T12:00:00Z");
      expect(module.getLastSeen()).toBe("2026-10-29T12:00:00Z"); expect(dispatchEvent).toHaveBeenCalledTimes(1);
      values.clear(); expect(module.getLastSeen()).toBe("");
      vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
      module.setLastSeen("2026-10-30T12:00:00Z"); expect(module.getLastSeen()).toBe("2026-10-30T12:00:00Z");
    } finally { vi.unstubAllGlobals(); }
  });
});
