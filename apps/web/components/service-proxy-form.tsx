"use client";

import { useState, useTransition } from "react";
import { useRouter } from "../lib/use-router";
import { saveServiceProxyAction, testServiceProxyAction } from "../app/actions";
import type { ProxyProbeResult } from "../lib/service-proxy-probe";
import { PROXY_SERVICES, PROXY_SERVICE_LABELS, type ProxyService } from "../lib/service-proxy-config";
import { runAction } from "../lib/run-action";

export function ServiceProxyForm({ configured, services: initialServices }: { configured: boolean; services: ProxyService[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [services, setServices] = useState(initialServices);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<ProxyProbeResult[]>([]);
  const [testing, setTesting] = useState(false);
  const [pending, startTransition] = useTransition();
  const save = (clear = false) => startTransition(async () => {
    setResults([]);
    const result = await runAction(() => saveServiceProxyAction({ url, services, clear }), setMessage);
    if (!result.ok) return;
    setMessage(result.value.message ?? (result.value.success ? "已保存" : "保存失败"));
    if (result.value.success) {
      setUrl("");
      if (clear) setServices([]);
      router.refresh();
    }
  });
  const test = () => startTransition(async () => {
    setTesting(true); setResults([]); setMessage("正在通过代理测试所选服务，每项最多等待 15 秒……");
    try {
      const result = await runAction(() => testServiceProxyAction({ url, services }), setMessage);
      if (!result.ok) return;
      setResults(result.value.results ?? []);
      setMessage(result.value.success ? "测试完成；未修改已保存的配置。" : result.value.message ?? "测试失败");
    } finally { setTesting(false); }
  });
  return (
    <div className="push-form">
      <div className="push-field">
        <label className="push-label" htmlFor="service-socks5-url">SOCKS5 代理地址</label>
        <input id="service-socks5-url" type="password" autoComplete="off" className="setting-control"
          disabled={pending} value={url} onChange={(event) => { setUrl(event.target.value); setResults([]); setMessage(""); }}
          placeholder={configured ? "已设置（留空保留，填写新地址可替换）" : "socks5://host:1080"} />
      </div>
      <div className="service-actions" role="group" aria-label="使用 SOCKS5 代理的服务">
        {PROXY_SERVICES.map((service) => <label key={service} className="service-toggle">
          <input type="checkbox" checked={services.includes(service)} disabled={pending}
            onChange={(event) => { setServices(event.target.checked ? [...services, service] : services.filter((s) => s !== service)); setResults([]); setMessage(""); }} />
          {PROXY_SERVICE_LABELS[service]}
        </label>)}
      </div>
      <p className="panel-note">仅勾选的服务走此代理；取消全部勾选可停用。地址需能从应用容器访问，支持用户名和密码。网盘、主模型及其他服务沿用原有连接。</p>
      <div className="service-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={() => save()}>保存代理设置</button>
        <button type="button" className="secondary-button" disabled={pending} onClick={test}>{pending && testing ? "测试中……" : "测试代理"}</button>
        {configured ? <button type="button" className="secondary-button" disabled={pending} onClick={() => save(true)}>清除代理</button> : null}
        {message ? <span className="panel-note" role="status">{message}</span> : null}
      </div>
      <p className="panel-note">测试使用当前输入的地址（留空使用已存地址）和勾选项，无需先保存；不发送服务密钥或执行 Jev 推理。容器内 127.0.0.1 指容器自身。</p>
      {results.length ? <ul aria-label="代理测试结果" className="panel-note">
        {results.map((item) => <li key={item.service}>{item.ok ? "✅" : "❌"} {PROXY_SERVICE_LABELS[item.service]}：{item.message}（{item.durationMs} ms）</li>)}
      </ul> : null}
    </div>
  );
}
