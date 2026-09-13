"use client";

import { useState } from "react";
import { Search, ExternalLink, Package, AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";

export function SSWTrackingView({ onBack }: { onBack?: () => void }) {
  const [danfeKey, setDanfeKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = danfeKey.replace(/\D/g, "");

    if (clean.length < 10) {
      setError("Por favor, digite a Chave DANFE (44 dígitos) ou número da nota.");
      return;
    }

    setError("");
    setLoading(true);

    // Cria um form invisível que submete direto para o ssw.inf.br
    // Isso abre a consulta oficial com o resultado dos parceiros no próprio SSW
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://ssw.inf.br/2/rastreamento_danfe";
    form.target = "_blank"; // abre em nova aba

    const inputDanfe = document.createElement("input");
    inputDanfe.type = "hidden";
    inputDanfe.name = "danfe";
    inputDanfe.value = clean;
    form.appendChild(inputDanfe);

    const inputUrl = document.createElement("input");
    inputUrl.type = "hidden";
    inputUrl.name = "urlori";
    inputUrl.value = "";
    form.appendChild(inputUrl);

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);

    setTimeout(() => {
      setLoading(false);
    }, 800);
  };

  return (
    <section className="panel" style={{ maxWidth: 900, margin: "0 auto" }}>
      <div className="panel-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={22} color="#0284c7" />
            <h2 style={{ margin: 0 }}>Rastreamento SSW de Parceiros (ssw.inf.br)</h2>
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Consulte notas fiscais transportadas pela rede de transportadoras parceiras usuárias do <strong>SSW Sistemas</strong>.
          </p>
        </div>
        <a
          href="https://ssw.inf.br/2/rastreamento_danfe"
          target="_blank"
          rel="noopener noreferrer"
          className="button secondary compact"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <ExternalLink size={14} /> Abrir SSW direto
        </a>
      </div>

      <div style={{ marginTop: 20, padding: 24, background: "var(--card-subtle)", borderRadius: 16, border: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, color: "var(--ink)" }}>
          <ShieldCheck size={20} color="var(--green)" />
          <strong style={{ fontSize: 14 }}>Consulta Oficial de Cargas de Parceiros</strong>
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          Digite abaixo a <strong>Chave de Acesso DANFE (44 dígitos)</strong> da NF-e emitida pelo seu fornecedor/parceiro. Ao clicar em <strong>Consultar no SSW</strong>, o sistema conectará com o portal oficial do SSW e abrirá a linha do tempo completa de ocorrências e comprovantes de entrega da transportadora responsável.
        </p>

        <form onSubmit={handleSearch} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)" }}>
            Chave DANFE da Nota Fiscal (44 dígitos)
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              value={danfeKey}
              onChange={(e) => setDanfeKey(e.target.value)}
              placeholder="Ex.: 2524 0900 0000 0000 0000 5500 1000 0001 2310 0000 1234"
              maxLength={54}
              style={{
                flex: 1,
                minWidth: 320,
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--card)",
                color: "var(--ink)",
                fontSize: 15,
                fontFamily: "monospace",
              }}
            />
            <button
              type="submit"
              disabled={loading}
              className="button primary"
              style={{
                padding: "14px 28px",
                background: "linear-gradient(135deg, #0284c7, #06b6d4)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 14,
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                borderRadius: 12,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(2, 132, 199, 0.35)",
              }}
            >
              <Search size={16} />
              {loading ? "Consultando..." : "Consultar no SSW"}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>

        {error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--red)", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--muted)" }}>
          <span>🔹 Suporta leitor de código de barras físico ou bipagem.</span>
          <span>Processado via <strong>ssw.inf.br</strong></span>
        </div>
      </div>
    </section>
  );
}
