import { connect } from "node:net";

export interface Socks5EntryResult { ok: boolean; message: string; durationMs: number }

/** Diagnose the proxy itself before contacting any upstream. Never sends a CONNECT
 * destination or service credentials; destroys the diagnostic socket on every exit. */
export function probeSocks5Entry(proxyUrl: string, timeoutMs = 5_000): Promise<Socks5EntryResult> {
  const url = new URL(proxyUrl);
  const username = Buffer.from(decodeURIComponent(url.username));
  const password = Buffer.from(decodeURIComponent(url.password));
  if (username.length > 255 || password.length > 255) return Promise.resolve({ ok: false, message: "SOCKS5 用户名或密码超过 255 字节。", durationMs: 0 });
  const started = Date.now();
  return new Promise((resolve) => {
    let done = false;
    let connected = false;
    let phase: "greeting" | "auth" = "greeting";
    let buffer = Buffer.alloc(0);
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port) });
    const finish = (ok: boolean, message: string) => {
      if (done) return;
      done = true; clearTimeout(timer); socket.destroy();
      resolve({ ok, message: `${url.hostname}:${url.port}：${message}`, durationMs: Date.now() - started });
    };
    const timer = setTimeout(() => finish(false, connected
      ? "TCP 已连通，但 SOCKS5 握手超时（SOCKS_HANDSHAKE_TIMEOUT）；请检查端口协议或代理认证。"
      : "连接代理入口超时（PROXY_TCP_TIMEOUT）；请检查容器到代理的路由、防火墙和监听地址。"), timeoutMs);
    socket.on("connect", () => {
      connected = true;
      socket.write(username.length || password.length ? Buffer.from([5, 2, 0, 2]) : Buffer.from([5, 1, 0]));
    });
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length < 2) return;
      const version = buffer[0]; const status = buffer[1]; buffer = buffer.subarray(2);
      if (phase === "greeting") {
        if (version !== 5) { finish(false, "TCP 已连通，但端口不是 SOCKS5（SOCKS_VERSION_MISMATCH）；请确认不是 HTTP 代理端口。"); return; }
        if (status === 0) { finish(true, "TCP 连接和 SOCKS5 握手成功（无需认证）。"); return; }
        if (status !== 2 || (!username.length && !password.length)) { finish(false, "TCP 已连通，但代理要求认证或拒绝认证方式（SOCKS_AUTH_REQUIRED）；请检查用户名和密码。"); return; }
        phase = "auth";
        socket.write(Buffer.concat([Buffer.from([1, username.length]), username, Buffer.from([password.length]), password]));
      } else {
        finish(version === 1 && status === 0, version === 1 && status === 0
          ? "TCP 连接、SOCKS5 握手和代理认证成功。"
          : "SOCKS5 用户名或密码认证失败（SOCKS_AUTH_FAILED）。");
      }
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      const messages: Record<string, string> = {
        ECONNREFUSED: "代理入口拒绝连接（ECONNREFUSED）；检查代理是否运行、是否允许局域网连接及监听端口。",
        EHOSTUNREACH: "应用无法到达代理主机（EHOSTUNREACH）；检查容器网段、宿主机路由和防火墙。",
        ENETUNREACH: "应用没有到代理的网络路由（ENETUNREACH）；检查容器网络和代理地址。",
        ENOTFOUND: "代理主机名无法解析（ENOTFOUND）。",
        EAI_AGAIN: "代理主机名解析暂时失败（EAI_AGAIN）。",
        ECONNRESET: "代理入口重置了连接（ECONNRESET）；检查端口协议或访问限制。",
        ETIMEDOUT: "连接代理入口超时（ETIMEDOUT）；检查网络路由、防火墙和监听地址。",
      };
      const nested = (error as NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] }).errors;
      const code = [error.code, ...(Array.isArray(nested) ? nested.slice(0, 6).map((e) => e?.code) : [])].find((value) => value && messages[value]);
      finish(false, messages[code ?? ""] ?? "代理入口连接失败（PROXY_TCP_ERROR）；请检查监听地址、端口和容器网络。");
    });
    socket.on("close", () => finish(false, connected
      ? "TCP 已连通，但代理在完成 SOCKS5 握手前关闭连接（SOCKS_EARLY_CLOSE）。"
      : "代理入口在建立连接前关闭（PROXY_EARLY_CLOSE）。"));
  });
}
