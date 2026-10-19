"use client";
import { useEffect } from "react";
import { validateTechnicalEvent } from "@/lib/technical-events";

export function ClientMonitor() {
  useEffect(() => {
    const recent = new Map<string, number>();
    const report = (detail: unknown) => {
      if (!navigator.onLine) return;
      const event = validateTechnicalEvent(detail);
      if (!event) return;
      const now = Date.now(), key = `${event.kind}:${event.path}`;
      for (const [item, time] of recent) if (now - time > 60_000) recent.delete(item);
      if (recent.has(key) || recent.size >= 5) return;
      recent.set(key, now);
      fetch("/api/telemetry/client-error", {
        method: "POST", keepalive: true, credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-RouteWise-Role": sessionStorage.getItem("rw_role") === "driver" ? "driver" : "dispatcher" },
        body: JSON.stringify(event),
      }).catch(() => {});
    };
    const failure = (event: Event) => report((event as CustomEvent).detail);
    const error = (event: ErrorEvent) => { if (event.error) report({ kind: "client_exception", path: location.pathname }); };
    const rejection = () => report({ kind: "client_exception", path: location.pathname });
    window.addEventListener("criarrota:technical-failure", failure);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      window.removeEventListener("criarrota:technical-failure", failure);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, []);
  return null;
}
