"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { APP_VERSION } from "@/lib/version";

export function AccountMenu({ name, company, themeControl, onPassword, onExit, onNotifications, onMaps, children }: {
  name?: string; company?: string; themeControl: ReactNode;
  onPassword: () => void; onExit: () => void; onNotifications?: () => void; onMaps?: () => void; children?: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [permissions, setPermissions] = useState("Consultando permissões…");
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && ref.current) ref.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const run = (action: () => void) => { if (ref.current) ref.current.open = false; action(); };
  return <details className="account-menu" ref={ref} onKeyDown={event => {
    if (event.key === "Escape" && ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label="Abrir conta e configurações" title="Minha conta e configurações">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg>
      <span>Minha conta</span>
    </summary>
    <div className="account-menu-panel">
      <h2>Minha conta</h2>
      <p className="account-identity"><strong>{name || "Usuário conectado"}</strong>{company && <span>{company}</span>}</p>
      <button type="button" onClick={() => run(onPassword)}>Alterar senha</button>
      <h2>Configurações</h2>
      <div className="account-theme-row"><span>Aparência · claro / escuro</span>{themeControl}</div>
      {onNotifications && <button type="button" onClick={() => run(onNotifications)}>Notificações e alertas</button>}
      {onMaps && <button type="button" onClick={() => run(onMaps)}>Mapas e localização</button>}
      <details className="account-permissions" onToggle={async event => {
        if (!event.currentTarget.open) return;
        const labels: Record<string, string> = { granted: "permitida", denied: "bloqueada", prompt: "solicitar ao usar", default: "solicitar ao usar" };
        let location = "consulte o navegador";
        try { location = labels[(await navigator.permissions.query({ name: "geolocation" })).state]; } catch {}
        const notification = typeof Notification === "undefined" ? "indisponíveis" : labels[Notification.permission];
        setPermissions(`Localização: ${location}. Notificações: ${notification}.`);
      }}><summary>Permissões do navegador</summary><p>{permissions}</p><p>Para alterar, use as permissões do site na barra de endereço.</p></details>
      {children && <div className="account-company-settings">{children}</div>}
      <button type="button" className="account-signout" onClick={() => run(onExit)}>Sair da conta</button>
      <small>Criar Rota · versão {APP_VERSION}</small>
    </div>
  </details>;
}
