"use client";
import { useEffect, useState } from "react";
import type { MetadataHealth } from "../lib/metadata-health";
export function MetadataHealthPanel() {
  const [services, setServices] = useState<MetadataHealth[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const media = matchMedia("(min-width: 861px)");
    let controller: AbortController | undefined;
    let busy = false;
    const refresh = async () => {
      if (!media.matches || document.hidden || busy) return;
      busy = true; controller = new AbortController();
      try {
        const response = await fetch("/api/metadata-health", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("probe unavailable");
        const body = await response.json(); setServices(body.services); setUnavailable(false);
      } catch { if (!controller.signal.aborted) setUnavailable(true); }
      finally { busy = false; }
    };
    const onChange = () => { void refresh(); };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60_000);
    media.addEventListener("change", onChange); document.addEventListener("visibilitychange", onChange);
    return () => { clearInterval(timer); controller?.abort(); media.removeEventListener("change", onChange); document.removeEventListener("visibilitychange", onChange); };
  }, []);
  return <section className="metadata-health" aria-label="元数据 API 连通状态">
    <div className="metadata-health-heading">元数据连接<span>60 秒更新</span></div>
    {(["TMDB", "AniList"] as const).map((service) => {
      const item = services.find((value) => value.service === service);
      return <div className="metadata-health-row" key={service}><span><i className={unavailable || item?.ok === false ? "is-down" : item?.ok ? "is-up" : "is-checking"} />{service}</span><span>{unavailable ? "检测不可用" : !item ? "检测中…" : item.ok ? `${item.latencyMs} ms` : "连接失败"}</span></div>;
    })}
  </section>;
}
