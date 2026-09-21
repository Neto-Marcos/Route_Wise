"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Boxes,
  CircleDollarSign,
  Download,
  FileText,
  Filter,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  TriangleAlert,
} from "lucide-react";

type Bucket = { orders: number; value: number };

export interface InvoicedNote {
  invoiceNumber: string;
  orderId: string;
  issueDate: string;
  client: string;
  city: string;
  uf: string;
  freightType: "CIF" | "FOB" | "OUTRO";
  totalValue: number;
  weightKg: number;
  itemsCount: number;
}

type Data = {
  filename: string;
  period: string;
  selectedMonth: string;
  availableMonths: string[];
  total: Bucket & { itemLines: number; requestedQty: number; availableQty: number };
  freight: { CIF: Bucket; FOB: Bucket; OUTRO: Bucket };
  invoiced: Bucket;
  pending: Bucket;
  ready: Bucket;
  blocked: Bucket;
  stock: { inStockLines: number; totalLines: number; coveragePct: number };
  topBlockedProducts: Array<{ product: string; department: string; shortage: number; value: number }>;
  invoicedNotesSummary?: { count: number; totalValue: number; totalWeightKg: number };
  invoicedNotes?: InvoicedNote[];
};

const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const card = (label: string, value: string, detail: string, color = "#2563eb") => (
  <div style={{ padding: "14px", border: "1px solid var(--line)", borderRadius: 14, background: "var(--card-subtle)" }}>
    <small style={{ color: "var(--muted)", fontWeight: 800, textTransform: "uppercase", fontSize: 11 }}>{label}</small>
    <strong style={{ display: "block", color, fontSize: 22, marginTop: 5 }}>{value}</strong>
    <span style={{ color: "var(--muted)", fontSize: 12 }}>{detail}</span>
  </div>
);

function formatMonthLabel(monthKey: string) {
  const parts = monthKey.split("-");
  if (parts.length === 2) {
    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
    if (!Number.isNaN(d.getTime())) {
      const name = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return monthKey;
}

export function CommercialDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"resumo" | "notas" | "frete" | "estoque">("resumo");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [freightFilter, setFreightFilter] = useState<"ALL" | "CIF" | "FOB">("ALL");

  const load = async (month?: string) => {
    setLoading(true);
    setError("");
    try {
      const url = month ? `/api/analytics/commercial?month=${month}` : "/api/analytics/commercial";
      const response = await fetch(url);
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Erro ${response.status}: Falha ao carregar a carteira`);
      }
      const json: Data = await response.json();
      setData(json);
      if (json.selectedMonth && !month) {
        setSelectedMonth(json.selectedMonth);
      }
    } catch (e: any) {
      setError(e.message || "Não foi possível carregar a carteira.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMonth = e.target.value;
    setSelectedMonth(newMonth);
    load(newMonth);
  };

  // Filtragem e busca na lista de notas faturadas
  const filteredNotes = useMemo(() => {
    if (!data?.invoicedNotes) return [];
    let list = data.invoicedNotes;

    if (freightFilter !== "ALL") {
      list = list.filter((n) => n.freightType === freightFilter);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (n) =>
          n.invoiceNumber.toLowerCase().includes(q) ||
          n.orderId.toLowerCase().includes(q) ||
          n.client.toLowerCase().includes(q) ||
          n.city.toLowerCase().includes(q) ||
          n.uf.toLowerCase().includes(q),
      );
    }
    return list;
  }, [data?.invoicedNotes, searchTerm, freightFilter]);

  // Exportar Notas Faturadas para CSV (compatível com Excel)
  const exportCsv = () => {
    if (!filteredNotes.length) return;
    const headerRow = [
      "Número da NF",
      "Pedido Sabium",
      "Data Emissão",
      "Cliente",
      "Cidade",
      "UF",
      "Tipo Frete",
      "Peso (kg)",
      "Itens",
      "Valor Total (R$)",
    ];
    const rows = filteredNotes.map((n) => [
      `"${n.invoiceNumber}"`,
      `"${n.orderId}"`,
      `"${n.issueDate}"`,
      `"${n.client.replace(/"/g, '""')}"`,
      `"${n.city.replace(/"/g, '""')}"`,
      `"${n.uf}"`,
      `"${n.freightType}"`,
      n.weightKg ? n.weightKg.toFixed(2).replace(".", ",") : "0",
      n.itemsCount,
      n.totalValue ? n.totalValue.toFixed(2).replace(".", ",") : "0,00",
    ]);

    const csvContent = "\uFEFF" + [headerRow.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `notas_faturadas_${selectedMonth || "mes"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CircleDollarSign size={21} color="#059669" /> Faturamento & Carteira Comercial
          </h2>
          <p>{data ? `Competência: ${data.period} · Base: ${data.filename}` : "Indicadores do faturamento e carteira ativa"}</p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {data?.availableMonths && data.availableMonths.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--card-subtle)", padding: "4px 10px", borderRadius: 8, border: "1px solid var(--line)" }}>
              <Filter size={14} color="var(--muted)" />
              <label htmlFor="month-select" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Mês:</label>
              <select
                id="month-select"
                value={selectedMonth || data.selectedMonth}
                onChange={handleMonthChange}
                disabled={loading}
                style={{
                  background: "transparent",
                  border: "none",
                  fontWeight: 700,
                  fontSize: 13,
                  color: "var(--ink)",
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                {data.availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {formatMonthLabel(m)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button className="button secondary compact" onClick={() => load(selectedMonth)} disabled={loading}>
            <RefreshCw size={15} className={loading ? "spin" : ""} /> Atualizar
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 7, overflowX: "auto", margin: "12px 0 16px" }}>
        {([
          ["resumo", "Resumo Financeiro", ShoppingCart],
          ["notas", `Notas Faturadas (${data?.invoicedNotes?.length ?? 0})`, FileText],
          ["frete", "CIF e FOB", Store],
          ["estoque", "Estoque Filial 281", Boxes],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            className={`button compact ${tab === id ? "primary" : "secondary"}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <p style={{ color: "var(--muted)" }}>Lendo a carteira e notas fiscais ativas...</p>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : data && (
        <>
          {/* ABA 1: RESUMO FINANCEIRO */}
          {tab === "resumo" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                {card("Faturamento no Mês", money(data.invoiced.value), `${data.invoicedNotes?.length ?? data.invoiced.orders} notas fiscais emitidas`, "#059669")}
                {card("Carteira Total Mês", money(data.total.value), `${data.total.orders} pedidos no período`)}
                {card("A Faturar (Pendente)", money(data.pending.value), `${data.pending.orders} pedidos com saldo pendente`, "#d97706")}
                {card("Pronto para Faturar", money(data.ready.value), `${data.ready.orders} pedidos com item disponível`, "#0f9f78")}
                {card("A Faturar sem Estoque", money(data.blocked.value), `${data.blocked.orders} pedidos bloqueados`, "#dc2626")}
              </div>
              <div style={{ marginTop: 14, padding: 13, borderRadius: 12, background: "rgba(5,150,105,.08)", color: "var(--ink)", fontSize: 13 }}>
                <strong>Visão de Faturamento:</strong> O total faturado considera todas as notas fiscais emitidas na competência selecionada (<b>{data.period}</b>). Pedidos com linhas parciais já emitidas têm as faturas contabilizadas em <b>Já faturado</b> e os itens remanescentes em <b>A faturar</b>.
              </div>
            </>
          )}

          {/* ABA 2: NOTAS FATURADAS NO MÊS */}
          {tab === "notas" && (
            <div>
              {/* Cards de Métricas de Faturamento */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
                {card("Total Faturado (NF)", money(data.invoicedNotesSummary?.totalValue ?? data.invoiced.value), "Soma das notas fiscais do mês", "#059669")}
                {card("Quantidade de NFs", String(data.invoicedNotes?.length ?? 0), "Notas emitidas no período", "#2563eb")}
                {card("Peso Total Faturado", `${(data.invoicedNotesSummary?.totalWeightKg ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`, "Carga despachada / faturada")}
                {card(
                  "Ticket Médio / NF",
                  money(data.invoicedNotes?.length ? (data.invoicedNotesSummary?.totalValue ?? data.invoiced.value) / data.invoicedNotes.length : 0),
                  "Valor médio por nota fiscal",
                  "#7c3aed"
                )}
              </div>

              {/* Filtros e Barra de Ações */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 260 }}>
                  <div style={{ position: "relative", flex: 1 }}>
                    <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--muted)" }} />
                    <input
                      type="text"
                      className="input compact"
                      placeholder="Buscar por NF, pedido, cliente, cidade..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ paddingLeft: 32, width: "100%", borderRadius: 8 }}
                    />
                  </div>
                  <select
                    className="input compact"
                    value={freightFilter}
                    onChange={(e) => setFreightFilter(e.target.value as any)}
                    style={{ width: 110, borderRadius: 8 }}
                  >
                    <option value="ALL">Todos Fretes</option>
                    <option value="CIF">Só CIF</option>
                    <option value="FOB">Só FOB</option>
                  </select>
                </div>

                <button
                  className="button secondary compact"
                  onClick={exportCsv}
                  disabled={!filteredNotes.length}
                  style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 8 }}
                >
                  <Download size={14} /> Exportar Excel / CSV
                </button>
              </div>

              {/* Tabela de Notas Faturadas */}
              <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 12 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                  <thead>
                    <tr style={{ background: "var(--card-subtle)", borderBottom: "1px solid var(--line)", color: "var(--muted)" }}>
                      <th style={{ padding: "10px 12px" }}>Nº da NF</th>
                      <th style={{ padding: "10px 12px" }}>Emissão</th>
                      <th style={{ padding: "10px 12px" }}>Pedido</th>
                      <th style={{ padding: "10px 12px" }}>Cliente</th>
                      <th style={{ padding: "10px 12px" }}>Destino</th>
                      <th style={{ padding: "10px 12px" }}>Frete</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Peso</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Valor da NF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredNotes.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                          Nenhuma nota fiscal faturada encontrada para este período ou filtro.
                        </td>
                      </tr>
                    ) : (
                      filteredNotes.map((note, idx) => (
                        <tr
                          key={`${note.invoiceNumber}_${note.orderId}_${idx}`}
                          style={{ borderBottom: "1px solid var(--line)", background: idx % 2 === 0 ? "transparent" : "rgba(0,0,0,0.015)" }}
                        >
                          <td style={{ padding: "10px 12px", fontWeight: 700, color: "#059669" }}>
                            {note.invoiceNumber}
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: "var(--muted)" }}>
                            {note.issueDate || "—"}
                          </td>
                          <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12 }}>
                            {note.orderId}
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={note.client}>
                            {note.client}
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                            {note.city ? `${note.city}${note.uf ? ` - ${note.uf}` : ""}` : (note.uf || "—")}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                background: note.freightType === "CIF" ? "rgba(37,99,235,0.1)" : note.freightType === "FOB" ? "rgba(124,58,237,0.1)" : "rgba(100,116,139,0.1)",
                                color: note.freightType === "CIF" ? "#2563eb" : note.freightType === "FOB" ? "#7c3aed" : "var(--muted)",
                              }}
                            >
                              {note.freightType}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--muted)", whiteSpace: "nowrap" }}>
                            {note.weightKg > 0 ? `${note.weightKg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg` : "—"}
                          </td>
                          <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#059669", whiteSpace: "nowrap" }}>
                            {money(note.totalValue)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {filteredNotes.length > 0 && (
                    <tfoot>
                      <tr style={{ background: "var(--card-subtle)", borderTop: "2px solid var(--line)", fontWeight: 700 }}>
                        <td colSpan={6} style={{ padding: "12px", textAlign: "right" }}>
                          Total ({filteredNotes.length} notas):
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "var(--muted)" }}>
                          {filteredNotes.reduce((sum, n) => sum + (n.weightKg || 0), 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#059669", fontSize: 14 }}>
                          {money(filteredNotes.reduce((sum, n) => sum + (n.totalValue || 0), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          {/* ABA 3: FRETE CIF vs FOB */}
          {tab === "frete" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
              {card("CIF", money(data.freight.CIF.value), `${data.freight.CIF.orders} pedidos · entrega pela casa`, "#2563eb")}
              {card("FOB", money(data.freight.FOB.value), `${data.freight.FOB.orders} pedidos · retirada pelo cliente`, "#7c3aed")}
              {data.freight.OUTRO.orders > 0 &&
                card("Frete não informado", money(data.freight.OUTRO.value), `${data.freight.OUTRO.orders} pedidos para conferir`, "#d97706")}
            </div>
          )}

          {/* ABA 4: ESTOQUE FILIAL 281 */}
          {tab === "estoque" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                {card("Linhas com saldo", `${data.stock.inStockLines}/${data.stock.totalLines}`, `${data.stock.coveragePct}% disponíveis`, "#059669")}
                {card("Quantidade solicitada", data.total.requestedQty.toLocaleString("pt-BR"), "itens da carteira")}
                {card("Atendida pelo saldo 281", data.total.availableQty.toLocaleString("pt-BR"), "quantidade disponível", "#0f9f78")}
              </div>
              <div style={{ marginTop: 16 }}>
                <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <TriangleAlert size={16} color="#dc2626" /> Maiores bloqueios para faturar
                </strong>
                {data.topBlockedProducts.length ? (
                  <div style={{ display: "grid", gap: 7, marginTop: 9 }}>
                    {data.topBlockedProducts.map((item) => (
                      <div
                        key={item.product}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "10px 0",
                          borderBottom: "1px solid var(--line)",
                          fontSize: 13,
                        }}
                      >
                        <span>
                          <b>{item.product}</b>
                          <small style={{ display: "block", color: "var(--muted)" }}>
                            {item.department} · faltam {item.shortage.toLocaleString("pt-BR")} unidades
                          </small>
                        </span>
                        <strong style={{ color: "#dc2626", whiteSpace: "nowrap" }}>{money(item.value)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--muted)" }}>Nenhum bloqueio de estoque identificado.</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
