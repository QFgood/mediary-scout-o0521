import { createSocks5Fetch } from "./service-proxy";
import type { ProxyService } from "./service-proxy-config";

export interface ProxyProbeTarget { service: ProxyService; url: string }
export interface ProxyProbeResult { service: ProxyService | "proxy"; ok: boolean; message: string; durationMs: number }

/** Read nested transport causes, but NEVER return their text: it can contain credentials. */
export function proxyFailureMessage(error: unknown): string {
  const chain: Array<{ name?: string; code?: string; message?: string; cause?: unknown; errors?: unknown[] }> = [];
  const pending = [error];
  while (pending.length && chain.length < 12) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || chain.includes(current)) continue;
    chain.push(current);
    const item = chain.at(-1)!;
    pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 6));
  }
  const codes = chain.map((e) => e.code ?? "");
  const text = chain.map((e) => e.message ?? "").join(" ");
  const hasCode = (code: string) => codes.includes(code) || new RegExp(`\\b${code}\\b`).test(text);
  if (hasCode("EHOSTUNREACH")) return "无法到达代理或目标主机（EHOSTUNREACH）；检查容器网络、路由和防火墙。";
  if (hasCode("ENETUNREACH")) return "没有可用网络路由（ENETUNREACH）；检查容器到代理的网络路径。";
  if (hasCode("ECONNRESET")) return "连接被重置（ECONNRESET）；检查代理协议、访问限制或出口线路。";
  if (hasCode("EAI_AGAIN")) return "DNS 暂时解析失败（EAI_AGAIN），请检查容器 DNS。";
  if (/authentication|no accepted auth/i.test(text)) return "SOCKS5 认证失败，请检查代理用户名和密码。";
  if (/initial handshake|invalid socks version/i.test(text)) return "端口未返回有效 SOCKS5 握手，请确认填写的是 SOCKS5 或混合端口，而非 HTTP 代理端口。";
  if (codes.includes("ECONNREFUSED") || /\bECONNREFUSED\b/.test(text)) return "代理连接被拒绝，请检查监听地址、端口、允许局域网连接及容器访问权限。";
  if (codes.includes("ENOTFOUND") || /\bENOTFOUND\b/.test(text)) return "无法解析代理主机名，请检查地址或容器 DNS。";
  if (codes.some((code) => /CERT|TLS|SSL/.test(code))) return "代理隧道后的 TLS 验证失败，请检查证书、系统时间或代理 HTTPS 拦截。";
  if (chain.some((e) => /TimeoutError|AbortError/.test(e.name ?? "")) || /timed out|timeout/i.test(text) || codes.includes("ETIMEDOUT")) return "15 秒内未完成连接；请检查代理可达性、出口线路及目标服务是否被阻断。";
  if (/proxy rejected connection|final handshake/i.test(text)) return "SOCKS5 已响应，但拒绝连接目标服务，请检查代理规则、DNS 和出口线路。";
  if (/socket closed/i.test(text) || hasCode("UND_ERR_SOCKET")) return "代理或目标提前关闭连接（SOCKET_CLOSED）；请检查代理协议、访问控制和出口。";
  const names = [...new Set(chain.map((e) => e.name).filter((name) => ["TypeError", "Error", "SocksClientError", "AggregateError"].includes(name ?? "")))].join(" → ");
  return `代理访问失败（${names || "UNKNOWN_TRANSPORT_ERROR"}），请检查 SOCKS5 协议、代理监听地址及出口线路。容器内 127.0.0.1 指容器自身。`;
}

/** Explicit, uncached requests: no saved keys, billable Jev inference or application cache. */
export async function probeServiceProxy(url: string, targets: ProxyProbeTarget[], fetchImpl = createSocks5Fetch(url)): Promise<ProxyProbeResult[]> {
  return Promise.all(targets.map(async (target) => {
    const started = Date.now();
    const result = (ok: boolean, message: string): ProxyProbeResult => ({ service: target.service, ok, message, durationMs: Date.now() - started });
    try {
      const post = target.service === "anilist" || target.service === "pansou";
      const response = await fetchImpl(target.url, {
        method: post ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(15_000),
        ...(post ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(target.service === "anilist" ? { query: "query { Page(page: 1, perPage: 1) { media(type: ANIME) { id } } }" } : { kw: "__probe__", res: "all" }) } : {}),
      });
      if (response.ok && target.service === "anilist") {
        const body = await response.json() as { data?: unknown; errors?: unknown };
        return body?.data && !body.errors ? result(true, "SOCKS5、HTTPS 和 AniList GraphQL 请求均成功。") : result(false, "已收到响应，但不是成功的 AniList GraphQL 数据，请检查接口地址或出口限制。");
      }
      await response.body?.cancel();
      if (target.service === "assrt" && response.status === 400) return result(true, "代理网络可达，assrt 返回 HTTP 400；探测未携带字幕令牌或搜索参数，不能据此判断字幕服务是否可用。");
      if (target.service === "jev" && response.status === 404) return result(true, "代理网络可达，Jev 的 GET 探测返回 HTTP 404；未执行推理，接口地址和密钥仍需在 Jev「保存并测试」中验证。");
      if (response.status === 401 || response.status === 405) return result(true, `代理网络可达，HTTP ${response.status}；本测试不发送服务密钥，不验证服务账号。`);
      if (response.status === 403) return result(false, "代理隧道已连通，但目标返回 HTTP 403，可能拒绝当前出口或要求认证。请检查出口线路及服务权限。");
      if (response.status === 429) return result(false, "代理隧道已连通，但目标返回 HTTP 429（请求限流），请稍后重试或更换出口。");
      return result(response.ok, response.ok ? "代理网络可达；本测试不验证服务密钥或执行 Jev 推理。" : `代理隧道已连通，但目标返回 HTTP ${response.status}。`);
    } catch (error) { return result(false, error instanceof SyntaxError ? "已收到响应，但响应不是有效 JSON，请检查接口或出口拦截。" : proxyFailureMessage(error)); }
  }));
}
