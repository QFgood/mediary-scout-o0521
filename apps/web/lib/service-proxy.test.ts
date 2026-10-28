import { afterEach, describe, expect, it, vi } from "vitest";
import { getGlobalDispatcher } from "undici";
import { createSocks5Fetch, getServiceProxyFetch } from "./service-proxy";
import { getServiceProxyConfig, normalizeSocks5Url, PROXY_SERVICES, SERVICE_PROXY_SETTING_KEY } from "./service-proxy-config";

afterEach(() => vi.unstubAllGlobals());

describe("selective SOCKS5 configuration", () => {
  it("is disabled by default and never installs a global dispatcher", async () => {
    const dispatcher = getGlobalDispatcher();
    const settings = { getSetting: async () => null };
    for (const service of PROXY_SERVICES) expect(await getServiceProxyFetch(settings, service)).toBeUndefined();
    expect(getGlobalDispatcher()).toBe(dispatcher);
  });

  it("only selected services receive a proxy transport; ignores unknown saved service names", async () => {
    const config = JSON.stringify({ url: "socks5://proxy.test:1080", services: ["jev", "llm", "storage", "github"] });
    const settings = { getSetting: async (key: string) => key === SERVICE_PROXY_SETTING_KEY ? config : null };
    expect((await getServiceProxyConfig(settings)).services).toEqual(["jev"]);
    expect(await getServiceProxyFetch(settings, "jev")).toBeTypeOf("function");
    for (const service of ["anilist", "tmdb", "pansou", "assrt"] as const) expect(await getServiceProxyFetch(settings, service)).toBeUndefined();
  });

  it("preserves per-call method, body and cancellation, rejects redirects and leaves unrelated fetches alone", async () => {
    const globalDispatcher = getGlobalDispatcher();
    const transport = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", transport);
    const signal = AbortSignal.timeout(1000);
    const proxyFetch = createSocks5Fetch("socks5h://user:p%40ss@proxy.test:1080");
    await proxyFetch("https://api.typesafe.ai/v1/systemone", { method: "POST", body: "test", signal });
    expect(transport).toHaveBeenCalledWith("https://api.typesafe.ai/v1/systemone", expect.objectContaining({ method: "POST", body: "test", signal, redirect: "error", dispatcher: expect.any(Object) }));
    await fetch("https://storage.test/files");
    expect(transport.mock.calls.at(-1)).toEqual(["https://storage.test/files"]);
    expect(getGlobalDispatcher()).toBe(globalDispatcher);
  });

  it.each(["http://user:secret@proxy.test:8080", "socks4://proxy.test:1080", "socks5://proxy.test", "socks5://proxy.test:0", "socks5://proxy.test:70000", "socks5://proxy.test:1080/path", "socks5://proxy.test:1080?q=x", "not-a-url"])("rejects invalid or unsupported addresses without leaking credentials: %s", (url) => {
    expect(() => normalizeSocks5Url(url)).toThrow("代理地址需为 socks5:");
    try { normalizeSocks5Url(url); } catch (error) { expect(String(error)).not.toContain("secret"); }
  });

  it("accepts IPv6 and authenticated SOCKS5 and SOCKS5h URLs", () => {
    expect(normalizeSocks5Url(" socks5://[::1]:1080 ")).toBe("socks5://[::1]:1080");
    expect(normalizeSocks5Url("socks5h://user:pass@proxy.test:7890/")).toBe("socks5h://user:pass@proxy.test:7890");
  });

  it("rejects corrupted settings instead of silently bypassing the proxy", async () => {
    await expect(getServiceProxyFetch({ getSetting: async () => "broken" }, "jev")).rejects.toThrow("配置无效");
  });
});
