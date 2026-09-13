"use client";

import { useState } from "react";
import { Search, ExternalLink, Package, Clock, MapPin, AlertCircle, ArrowLeft, RefreshCw, CheckCircle2 } from "lucide-react";

export function SSWTrackingView({ onBack }: { onBack?: () => void }) {
  const [danfeKey, setDanfeKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<any | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanKey = danfeKey.replace(/\D/g, "");

    if (cleanKey.length < 1) {
      setError("Por favor, digite a Chave DANFE (44 dígitos) ou o Número da Nota.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/ssw/rastreio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ danfeKey: cleanKey, invoiceNumber: cleanKey }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao consultar SSW");
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Não foi possível carregar o rastreamento no momento.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div className="panel-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={22} color="var(--green)" />
            <h2 style={{ margin: 0 }}>Rastreamento pelo DANFE — SSW Sistemas</h2>
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Consulta direta integrada ao portal <strong>ssw.inf.br/2/rastreamento_danfe</strong>
          </p>
        </div>
        <a
          href="https://ssw.inf.br/2/rastreamento_danfe"
          target="_blank"
          rel="noopener noreferrer"
          className="button secondary compact"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <ExternalLink size={14} /> Abrir SSW Oficial
        </a>
      </div>

      {/* Input Form matching ssw.inf.br style */}
      <form onSubmit={handleSearch} style={{ marginTop: 24, padding: 20, background: "var(--card-subtle)", borderRadius: 14, border: "1px solid var(--line)" }}>
        <label style={{ display: "block", marginBottom: 8, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)" }}>
          Chave DANFE (44 dígitos) ou Número da Nota Fiscal
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            type="text"
            value={danfeKey}
            onChange={(e) => setDanfeKey(e.target.value)}
            placeholder="Ex.: 41260900000000000000550010000001231000001234"
            maxLength={50}
            style={{
              flex: 1,
              minWidth: 280,
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid var(--line)",
              background: "var(--card)",
              color: "var(--ink)",
              fontSize: 14,
            }}
          />
          <button
            type="submit"
            disabled={loading}
            className="button primary"
            style={{
              padding: "12px 24px",
              background: "var(--navy)",
              color: "#fff",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
            }}
          >
            {loading ? <RefreshCw size={16} className="spin" /> : <Search size={16} />}
            RASTREAR
          </button>
        </div>
        <small style={{ display: "block", marginTop: 8, color: "var(--muted)", fontSize: 12 }}>
          💡 Digite a chave de 44 dígitos ou capture-a com o leitor de código de barras.
        </small>
      </form>

      {error && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "var(--red)", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* SSW Timeline / Occurrences Result */}
      {result && (
        <div style={{ marginTop: 24, padding: 20, borderRadius: 14, background: "var(--card)", border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, borderBottom: "1px solid var(--line)", paddingBottom: 16, marginBottom: 16 }}>
            <div>
              <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "var(--muted)" }}>Nota Fiscal / Documento</span>
              <h3 style={{ margin: "2px 0 0", fontSize: 20 }}>NF {result.invoiceNumber}</h3>
              <small style={{ color: "var(--muted)", fontSize: 11, wordBreak: "break-all" }}>Chave: {result.danfeKey}</small>
            </div>
            <div style={{ textAlign: "right" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, background: "rgba(16,185,129,0.15)", color: "var(--green)", fontWeight: 800, fontSize: 12 }}>
                <CheckCircle2 size={14} /> {result.status}
              </span>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--muted)" }}>
                {result.originCity} ➔ {result.destinationCity}
              </p>
            </div>
          </div>

          <h4 style={{ margin: "0 0 14px", fontSize: 14, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)" }}>
            Linha do Tempo de Ocorrências (SSW)
          </h4>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {result.occurrences?.map((occ: any, i: number) => (
              <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: 12, borderRadius: 10, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: i === result.occurrences.length - 1 ? "var(--green)" : "var(--line)", color: "#fff", display: "grid", placeItems: "center", flexShrink: 0, fontWeight: 700, fontSize: 12 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 13, color: "var(--ink)" }}>{occ.occurrenceName}</strong>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      <Clock size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />
                      {new Date(occ.date).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--muted)" }}>
                    {occ.status} · <strong>{occ.city}</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
