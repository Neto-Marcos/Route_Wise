"use client";

import catalog from "@/lib/error-pages.json";

type ErrorCode = keyof typeof catalog;

export function ErrorScreen({ code, reset, reference }: { code: ErrorCode; reset?: () => void; reference?: string }) {
  const [title, message] = catalog[code];
  const label = code === "offline" ? "Sem conexão" : code === "unexpected" ? "Ops" : code;
  return (
    <>
      <link rel="stylesheet" href="/error-pages.css" />
      <main className="error-shell">
        <section className="error-card" aria-labelledby="error-title">
          <a className="error-brand" href="/"><img src="/icon.svg" alt="" width={32} height={32} />Criar Rota</a>
          <span className="error-code">{label}</span>
          <h1 id="error-title">{title}</h1>
          <p>{message}</p>
          <div className="error-actions">
            {reset && <button type="button" className="error-primary" onClick={reset}>Tentar novamente</button>}
            <a className={reset ? undefined : "error-primary"} href="/">{code === "401" ? "Entrar no sistema" : "Voltar ao início"}</a>
          </div>
          <p className="error-reference">{reference ? `Referência: ${reference}` : `Criar Rota · ${label}`}</p>
        </section>
      </main>
    </>
  );
}
