"use client";
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";
const Context = createContext<{ state: "loading" | "complete" | "error"; complete: (failed?: boolean) => void }>({ state: "loading", complete: () => {} });
export function SearchLoadBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "complete" | "error">("loading");
  const complete = useCallback((failed = false) => setState((previous) => failed || previous === "error" ? "error" : "complete"), []);
  return <Context.Provider value={{ state, complete }}>{children}</Context.Provider>;
}
export function SearchLoadBadge() {
  const { state } = useContext(Context);
  const loaded = state !== "loading";
  return <span className={`metadata-load-status ${state === "error" ? "is-error" : loaded ? "is-complete" : ""}`} role="status" aria-live="polite">
    {state === "error" ? <TriangleAlert size={14} aria-hidden /> : loaded ? <CheckCircle2 size={14} aria-hidden /> : <LoaderCircle size={14} className="spin" aria-hidden />}
    {state === "error" ? "元数据连接异常" : loaded ? "元数据加载完成" : "正在加载元数据…"}
  </span>;
}
export function SearchLoadComplete({ failed = false }: { failed?: boolean }) {
  const { complete } = useContext(Context);
  useEffect(() => { complete(failed); }, [complete, failed]);
  return null;
}
