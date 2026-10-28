import { socksDispatcher } from "fetch-socks";
import { getServiceProxyConfig, type ProxyService, type ProxySettingsSource, type ServiceProxyConfig } from "./service-proxy-config";

/** Only explicitly injected service clients use this fetch. No global dispatcher,
 * environment variables, system proxy or other application traffic is modified. */
export function createSocks5Fetch(proxyUrl: string, fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)): typeof fetch {
  const url = new URL(proxyUrl);
  return async (input, init) => {
    const dispatcher = socksDispatcher({
      type: 5,
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port),
      userId: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    });
    try {
      // A redirect must not extend the proxy to a different service. Callers retain
      // their existing deadlines, methods, bodies and TLS certificate verification.
      return await fetchImpl(input, { ...init, redirect: "error", dispatcher } as RequestInit);
    } finally {
      // close() waits for the response body to finish before releasing connections.
      void dispatcher.close().catch(() => {});
    }
  };
}

export function serviceProxyUrl(config: ServiceProxyConfig, service: ProxyService): string {
  return config.services.includes(service) ? config.url : "";
}

/** Undefined keeps the service's normal transport (including existing fetch mocks). */
export async function getServiceProxyFetch(settings: ProxySettingsSource, service: ProxyService): Promise<typeof fetch | undefined> {
  const url = serviceProxyUrl(await getServiceProxyConfig(settings), service);
  return url ? createSocks5Fetch(url) : undefined;
}
