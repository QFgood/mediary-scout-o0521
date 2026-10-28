import { createServer, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchTmdbList, AssrtSubtitleProvider } from "@media-track/workflow";
import { getTmdbAccesses, resolveJevJudge } from "./workflow-runtime";
import { AniListClient } from "./anilist/client";
import { getServiceProxyFetch } from "./service-proxy";
import { PROXY_SERVICES, SERVICE_PROXY_SETTING_KEY } from "./service-proxy-config";
import { buildPanSouProviderChain } from "./pansou-chain";
import { probeJev } from "./jev-probe";
import { probePanSou } from "./pansou-probe";
import { probeServiceProxy } from "./service-proxy-probe";

/** An in-process SOCKS5 endpoint. It answers the tunneled HTTP request itself;
 * no destination connection, DNS lookup, API key or external service is used. */
describe("SOCKS5 wire routing for the five supported services", () => {
  const destinations: string[] = [];
  const credentials: string[] = [];
  const sockets = new Set<Socket>();
  const response = JSON.stringify({
    model: "test-jev", answers: { probe: { noul: 1 }, c0: { noul: 1 }, n0: { noul: 0 } },
    code: 0, data: { results: [], total: 0, Page: { media: [] } }, status: 0, sub: { subs: [] }, marker: "through-socks",
  });
  let server: ReturnType<typeof createServer>;
  let proxyUrl: string;
  beforeEach(async () => {
    destinations.length = 0; credentials.length = 0;
    server = createServer((socket) => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      let phase = "greeting";
      let buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        if (phase === "greeting") {
          if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
          buffer = buffer.subarray(2 + buffer[1]!);
          socket.write(Buffer.from([5, 2])); phase = "auth";
        }
        if (phase === "auth") {
          if (buffer.length < 2 || buffer.length < 3 + buffer[1]!) return;
          const userLength = buffer[1]!;
          const passwordLength = buffer[2 + userLength]!;
          if (buffer.length < 3 + userLength + passwordLength) return;
          credentials.push(buffer.subarray(2, 2 + userLength).toString() + ":" + buffer.subarray(3 + userLength, 3 + userLength + passwordLength).toString());
          buffer = buffer.subarray(3 + userLength + passwordLength);
          socket.write(Buffer.from([1, 0])); phase = "connect";
        }
        if (phase === "connect") {
          if (buffer.length < 5) return;
          const length = buffer[3] === 3 ? buffer[4]! : buffer[3] === 1 ? 4 : 16;
          const offset = buffer[3] === 3 ? 5 : 4;
          if (buffer.length < offset + length + 2) return;
          destinations.push(buffer.subarray(offset, offset + length).toString());
          buffer = buffer.subarray(offset + length + 2);
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80])); phase = "http";
        }
        if (phase === "http") {
          const end = buffer.indexOf("\r\n\r\n");
          if (end < 0) return;
          const size = Number(/content-length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1] ?? 0);
          if (buffer.length < end + 4 + size) return;
          phase = "done";
          socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(response)}\r\nConnection: close\r\n\r\n${response}`);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    proxyUrl = `socks5h://user:p%40ss@127.0.0.1:${address.port}`;
  });
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("routes metadata, both PanSou paths, assrt search/detail and both Jev paths through SOCKS5", async () => {
    const values: Record<string, string> = {
      [SERVICE_PROXY_SETTING_KEY]: JSON.stringify({ url: proxyUrl, services: PROXY_SERVICES }),
      jev_api_key: "dummy", jev_base_url: "http://jev.test/decisions", jev_health: "ok", jev_prefilter_enabled: "1",
    };
    const settings = { getSetting: async (key: string) => values[key] ?? null };
    const anilist = new AniListClient({ endpoint: "http://anilist.test/graphql", fetch: (await getServiceProxyFetch(settings, "anilist"))! });
    expect(await anilist.search("test")).toEqual([]);
    const accesses = await getTmdbAccesses(settings, { NODE_ENV: "test", TMDB_PROXY_BASE_URL: "http://tmdb.test/3" });
    expect(await fetchTmdbList(accesses, "/trending", {})).toHaveProperty("marker", "through-socks");
    const pansouFetch = (await getServiceProxyFetch(settings, "pansou"))!;
    expect((await probePanSou("http://pansou.test", { fetchImpl: pansouFetch })).ok).toBe(true);
    const pansou = buildPanSouProviderChain({ userBaseURL: "http://pansou.test", allowedTypes: ["115"], fetchImpl: pansouFetch });
    expect((await pansou.search({ keyword: "test" })).sourceHealth?.status).toBe("healthy");
    const assrtTransport = (await getServiceProxyFetch(settings, "assrt"))!;
    // The local wire fixture speaks HTTP only. Keep assrt's real destination host
    // and exercise its fetch seam without an external TLS server or test CA.
    const assrt = new AssrtSubtitleProvider({ token: "dummy", fetchImpl: (input, init) => assrtTransport(String(input).replace(/^https:/, "http:"), init) });
    expect(await assrt.search("test")).toEqual([]);
    expect(await assrt.detail(1)).toEqual([]);
    expect((await probeJev({ apiKey: "dummy", baseUrl: "http://jev.test/decisions" }, { fetchImpl: (await getServiceProxyFetch(settings, "jev"))! })).ok).toBe(true);
    const jev = await resolveJevJudge(settings, { NODE_ENV: "test" });
    expect((await jev!.judgeCandidates({ target: { kind: "tv", title: "test", aliases: [] }, candidates: [{ id: "1", title: "test" }] })).scores["1"]).toBe(1);
    for (const host of ["anilist.test", "tmdb.test", "pansou.test", "api.assrt.net", "jev.test"]) expect(destinations).toContain(host);
    expect(destinations.filter((host) => host === "api.assrt.net")).toHaveLength(2);
    expect(credentials.every((value) => value === "user:p@ss")).toBe(true);
  });

  it("propagates cancellation and never falls back to a direct destination connection", async () => {
    const values = { url: proxyUrl.replace(/:\d+$/, ":1"), services: ["jev"] };
    const proxy = (await getServiceProxyFetch({ getSetting: async () => JSON.stringify(values) }, "jev"))!;
    await expect(proxy("http://destination.test", { signal: AbortSignal.timeout(200) })).rejects.toThrow();
    expect(destinations).toEqual([]);
  });
  it("diagnoses an HTTP-only port mistakenly configured as SOCKS5", async () => {
    server.removeAllListeners("connection");
    server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {}); socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"); });
    const results = await probeServiceProxy(proxyUrl, [{ service: "anilist", url: "https://graphql.anilist.co" }]);
    expect(results[0]).toMatchObject({ ok: false, message: expect.stringContaining("SOCKS5 握手") });
  });
});
