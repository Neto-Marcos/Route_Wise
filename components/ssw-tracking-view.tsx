"use client";

import { useState } from "react";
import { Search, ExternalLink, Package, AlertCircle, ArrowRight, ShieldCheck, UserCheck, FileText } from "lucide-react";

export function SSWTrackingView({ onBack }: { onBack?: () => void }) {
  const [searchType, setSearchType] = useState<"danfe" | "cpf" | "cnpj">("danfe");
  const [queryValue, setQueryValue] = useState("");
  const [cnpjPassword, setCnpjPassword] = useState("");
  const [daysLimit, setDaysLimit] = useState("30");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = queryValue.replace(/\D/g, "");

    if (searchType === "danfe" && clean.length < 10) {
      setError("Por favor, digite a Chave DANFE (44 dígitos) ou número da nota.");
      return;
    }

    if (searchType === "cpf" && clean.length !== 11) {
      setError("Por favor, digite um CPF válido com 11 dígitos.");
      return;
    }

    if (searchType === "cnpj" && clean.length !== 14) {
      setError("Por favor, digite um CNPJ válido com 14 dígitos.");
      return;
    }

    setError("");
    setLoading(true);

    const form = document.createElement("form");
    form.method = "POST";
    form.target = "_blank"; // abre em nova aba

    if (searchType === "danfe") {
      form.action = "https://ssw.inf.br/2/rastreamento_danfe";

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
    } else {
      // Rastreamento por CPF ou CNPJ (resultSSW_dest)
      form.action = "https://ssw.inf.br/2/resultSSW_dest";

      const inputCnpj = document.createElement("input");
      inputCnpj.type = "hidden";
      inputCnpj.name = "cnpjdest";
      inputCnpj.value = clean;
      form.appendChild(inputCnpj);

      if (searchType === "cnpj" && cnpjPassword) {
        const inputSenha = document.createElement("input");
        inputSenha.type = "hidden";
        inputSenha.name = "senha";
        inputSenha.value = cnpjPassword;
        form.appendChild(inputSenha);
      }

      const inputDias = document.createElement("input");
      inputDias.type = "hidden";
      inputDias.name = "limite_dias";
      inputDias.value = daysLimit;
      form.appendChild(inputDias);
    }

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);

    setTimeout(() => {
      setLoading(false);
    }, 800);
  };

  return (
    <section className="panel" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="panel-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line)", paddingBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Package size={22} color="#0284c7" />
            <h2 style={{ margin: 0 }}>Rastreamento SSW de Parceiros (ssw.inf.br)</h2>
          </div>
          <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 13 }}>
            Consulte notas de fornecedores e parceiros por <strong>Chave DANFE</strong>, <strong>CPF</strong> ou <strong>CNPJ do Destinatário</strong>.
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
        {/* Toggle de Tipo de Rastreio */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
          <button
            type="button"
            className={`button compact ${searchType === "danfe" ? "primary" : "secondary"}`}
            style={{ borderRadius: 999, padding: "8px 16px", background: searchType === "danfe" ? "#0284c7" : undefined, border: "none" }}
            onClick={() => { setSearchType("danfe"); setQueryValue(""); setError(""); }}
          >
            <FileText size={14} /> Pela Chave DANFE (44 dígitos)
          </button>
          <button
            type="button"
            className={`button compact ${searchType === "cpf" ? "primary" : "secondary"}`}
            style={{ borderRadius: 999, padding: "8px 16px", background: searchType === "cpf" ? "#0284c7" : undefined, border: "none" }}
            onClick={() => { setSearchType("cpf"); setQueryValue(""); setError(""); }}
          >
            <UserCheck size={14} /> Pelo CPF do Cliente (Pessoa Física)
          </button>
          <button
            type="button"
            className={`button compact ${searchType === "cnpj" ? "primary" : "secondary"}`}
            style={{ borderRadius: 999, padding: "8px 16px", background: searchType === "cnpj" ? "#0284c7" : undefined, border: "none" }}
            onClick={() => { setSearchType("cnpj"); setQueryValue(""); setError(""); }}
          >
            <ShieldCheck size={14} /> Pelo CNPJ da Empresa (Pessoa Jurídica)
          </button>
        </div>

        <form onSubmit={handleSearch} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <label style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)" }}>
            {searchType === "danfe"
              ? "Chave DANFE da Nota Fiscal (44 dígitos)"
              : searchType === "cpf"
              ? "CPF do Destinatário (11 dígitos)"
              : "CNPJ da Empresa Destinatária (14 dígitos)"}
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              value={queryValue}
              onChange={(e) => setQueryValue(e.target.value)}
              placeholder={
                searchType === "danfe"
                  ? "Ex.: 2524 0900 0000 0000 0000 5500 1000 0001 2310 0000 1234"
                  : searchType === "cpf"
                  ? "000.000.000-00"
                  : "00.000.000/0001-00"
              }
              maxLength={searchType === "danfe" ? 54 : searchType === "cpf" ? 14 : 18}
              style={{
                flex: 1,
                minWidth: 280,
                padding: "14px 16px",
                borderRadius: 12,
                border: "1px solid var(--line)",
                background: "var(--card)",
                color: "var(--ink)",
                fontSize: 15,
                fontFamily: "monospace",
              }}
            />

            {searchType === "cnpj" && (
              <input
                type="password"
                value={cnpjPassword}
                onChange={(e) => setCnpjPassword(e.target.value)}
                placeholder="Senha (opcional se fornecida pelo parceiro)"
                style={{
                  minWidth: 200,
                  padding: "14px 16px",
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                  background: "var(--card)",
                  color: "var(--ink)",
                  fontSize: 14,
                }}
              />
            )}

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

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Considerar entregas dos últimos:</span>
            <select
              value={daysLimit}
              onChange={(e) => setDaysLimit(e.target.value)}
              style={{
                background: "var(--card)",
                color: "var(--ink)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "4px 8px",
                fontSize: 12,
              }}
            >
              <option value="10">10 dias</option>
              <option value="20">20 dias</option>
              <option value="30">30 dias</option>
            </select>
          </div>
        </form>

        {error && (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--red)", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, fontSize: 12, color: "var(--muted)" }}>
          <span>🔹 Consulta em tempo real aos servidores oficiais do <strong>SSW Sistemas</strong>.</span>
          <span>Compatível com todas as transportadoras usuárias do SSW.</span>
        </div>
      </div>
    </section>
  );
}
