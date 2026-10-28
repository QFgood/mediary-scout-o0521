import { createServer, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probeSocks5Entry } from "./socks5-entry-probe";

describe("proxy entry stage", () => {
  let server: ReturnType<typeof createServer> | undefined;
  const sockets = new Set<Socket>();
  async function start(handler: (socket: Socket) => void) {
    server = createServer((socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {}); handler(socket); });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return `socks5://127.0.0.1:${(server.address() as { port: number }).port}`;
  }
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });
  it("checks a real fragmented SOCKS5 greeting without contacting any upstream", async () => {
    const url = await start((socket) => socket.once("data", () => { socket.write(Buffer.from([5])); setImmediate(() => socket.write(Buffer.from([0]))); }));
    expect(await probeSocks5Entry(url)).toMatchObject({ ok: true, message: expect.stringContaining("无需认证") });
  });
  it.each([0, 1])("checks username/password authentication (status %i)", async (status) => {
    const url = await start((socket) => socket.once("data", () => {
      socket.write(Buffer.from([5, 2]));
      socket.once("data", (data) => {
        expect(data).toEqual(Buffer.from([1, 1, 117, 1, 112]));
        socket.write(Buffer.from([1, status]));
      });
    }));
    const result = await probeSocks5Entry(url.replace("socks5://", "socks5://u:p@"));
    expect(result.ok).toBe(status === 0);
    expect(result.message).not.toContain("u:p");
  });
  it("distinguishes HTTP-only ports from an unreachable entry", async () => {
    const url = await start((socket) => socket.once("data", () => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")));
    expect(await probeSocks5Entry(url)).toMatchObject({ ok: false, message: expect.stringContaining("SOCKS_VERSION_MISMATCH") });
  });
  it("distinguishes successful TCP connection with a silent proxy", async () => {
    const url = await start((socket) => socket.resume());
    expect(await probeSocks5Entry(url, 100)).toMatchObject({ ok: false, message: expect.stringContaining("SOCKS_HANDSHAKE_TIMEOUT") });
  });
  it("reports a premature close with the failed stage", async () => {
    const url = await start((socket) => socket.once("data", () => socket.end()));
    expect(await probeSocks5Entry(url)).toMatchObject({ ok: false, message: expect.stringContaining("SOCKS_EARLY_CLOSE") });
  });
});
