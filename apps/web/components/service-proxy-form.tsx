"use client";

import { useState, useTransition } from "react";
import { useRouter } from "../lib/use-router";
import { saveServiceProxyAction } from "../app/actions";
import { PROXY_SERVICES, PROXY_SERVICE_LABELS, type ProxyService } from "../lib/service-proxy-config";
import { runAction } from "../lib/run-action";

export function ServiceProxyForm({ configured, services: initialServices }: { configured: boolean; services: ProxyService[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [services, setServices] = useState(initialServices);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const save = (clear = false) => startTransition(async () => {
    const result = await runAction(() => saveServiceProxyAction({ url, services, clear }), setMessage);
    if (!result.ok) return;
    setMessage(result.value.message ?? (result.value.success ? "已保存" : "保存失败"));
    if (result.value.success) {
      setUrl("");
      if (clear) setServices([]);
      router.refresh();
    }
  });
  return (
    <div className="push-form">
      <div className="push-field">
        <label className="push-label" htmlFor="service-socks5-url">SOCKS5 代理地址</label>
        <input id="service-socks5-url" type="password" autoComplete="off" className="setting-control"
          value={url} onChange={(event) => setUrl(event.target.value)}
          placeholder={configured ? "已设置（留空保留，填写新地址可替换）" : "socks5://host:1080"} />
      </div>
      <div className="service-actions" role="group" aria-label="使用 SOCKS5 代理的服务">
        {PROXY_SERVICES.map((service) => <label key={service} className="service-toggle">
          <input type="checkbox" checked={services.includes(service)} disabled={pending}
            onChange={(event) => setServices(event.target.checked ? [...services, service] : services.filter((s) => s !== service))} />
          {PROXY_SERVICE_LABELS[service]}
        </label>)}
      </div>
      <p className="panel-note">仅勾选的服务走此代理；取消全部勾选可停用。地址需能从应用容器访问，支持用户名和密码。网盘、主模型及其他服务沿用原有连接。</p>
      <div className="service-actions">
        <button type="button" className="primary-button" disabled={pending} onClick={() => save()}>保存代理设置</button>
        {configured ? <button type="button" className="secondary-button" disabled={pending} onClick={() => save(true)}>清除代理</button> : null}
        {message ? <span className="panel-note" role="status">{message}</span> : null}
      </div>
    </div>
  );
}
