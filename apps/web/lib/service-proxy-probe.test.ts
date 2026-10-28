import { describe, expect, it, vi } from "vitest";
import { probeServiceProxy, proxyFailureMessage } from "./service-proxy-probe";

describe("proxy diagnostics", () => {
  it("makes an uncached AniList request through the supplied transport and accepts GraphQL data", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: { Page: { media: [] } } }));
    expect((await probeServiceProxy("socks5://proxy.test:1080", [{ service: "anilist", url: "https://graphql.anilist.co" }], fetchImpl))[0]?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://graphql.anilist.co", expect.objectContaining({ method: "POST", cache: "no-store", signal: expect.any(AbortSignal) }));
  });
  it("reports each service independently and distinguishes network reachability from authentication", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => new Response(null, { status: String(url).includes("anilist") ? 403 : 401 }));
    const results = await probeServiceProxy("socks5://proxy.test:1080", [{ service: "anilist", url: "https://anilist.test" }, { service: "tmdb", url: "https://tmdb.test" }], fetchImpl);
    expect(results[0]).toMatchObject({ ok: false, message: expect.stringContaining("403") });
    expect(results[1]).toMatchObject({ ok: true, message: expect.stringContaining("不验证服务账号") });
    for (const call of fetchImpl.mock.calls) expect(call[1]).not.toHaveProperty("headers.Authorization");
  });
  it("does not mistake a GraphQL error for success and never returns the upstream error text", async () => {
    const results = await probeServiceProxy("socks5://proxy.test:1080", [{ service: "anilist", url: "https://anilist.test" }], async () => Response.json({ errors: [{ message: "private-value" }] }));
    expect(results[0]?.ok).toBe(false);
    expect(JSON.stringify(results)).not.toContain("private-value");
  });
  it("uses GET without API keys or paid inference for Jev", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 405 }));
    const results = await probeServiceProxy("socks5://proxy.test:1080", [{ service: "jev", url: "https://jev.test" }], fetchImpl);
    expect(results[0]?.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("https://jev.test", expect.objectContaining({ method: "GET" }));
    expect(fetchImpl.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
  it.each([
    [new AggregateError([Object.assign(new Error("private address secret"), { code: "EHOSTUNREACH" })]), "EHOSTUNREACH"],
    [new Error("fetch failed", { cause: new Error("connect ENETUNREACH secret") }), "ENETUNREACH"],
    [new Error("Socket closed secret"), "SOCKET_CLOSED"],
    [new Error("fetch failed", { cause: Object.assign(new Error("secret"), { code: "ECONNREFUSED" }) }), "连接被拒绝"],
    [new Error("fetch failed", { cause: new Error("Received invalid Socks5 initial handshake (invalid socks version) secret") }), "SOCKS5 握手"],
    [new Error("fetch failed", { cause: new Error("Socks5 Authentication failed secret") }), "认证失败"],
    [new DOMException("secret", "TimeoutError"), "15 秒"],
    [Object.assign(new Error("secret"), { code: "CERT_HAS_EXPIRED" }), "TLS"],
  ])("classifies nested transport failures without exposing raw secrets", (error, expected) => {
    expect(proxyFailureMessage(error)).toContain(expected);
    expect(proxyFailureMessage(error)).not.toContain("secret");
  });
});
