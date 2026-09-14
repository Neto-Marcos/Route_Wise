"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Send,
  Truck,
  Upload,
  X,
} from "lucide-react";
import type { SuggestedRoute, EngineResult, EngineConfig } from "@/lib/route-engine";
import type { OrderRow } from "@/lib/spreadsheet-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Driver { id: string; name: string; phone?: string; active?: boolean; }
interface Vehicle { id: string; name: string; plate: string; capacity_m3?: number; active?: boolean; }

// ─── Util ─────────────────────────────────────────────────────────────────────

async function api<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

function fmt(n: number, dec = 2) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function OccupancyBar({ pct, warning }: { pct: number; warning?: string }) {
  const color = pct >= 90 ? "var(--red)" : pct >= 75 ? "var(--amber)" : "var(--green)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 8, background: "var(--line)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 999, transition: "width .4s ease" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: "right" }}>{pct}%</span>
      {warning && <AlertTriangle size={14} color="var(--amber)" />}
    </div>
  );
}

function Badge({ text, color = "muted" }: { text: string; color?: "green" | "amber" | "red" | "muted" | "blue" }) {
  const map = { green: "#10b981", amber: "#f59e0b", red: "#ef4444", muted: "#64748b", blue: "#3b82f6" };
  const c = map[color];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 999, border: `1px solid ${c}55`, background: `${c}18`, color: c, fontSize: 11, fontWeight: 700 }}>
      {text}
    </span>
  );
}

// ─── Step 1: Upload ─────────────────────────────────────────────────────────

function UploadStep({
  onParsed,
}: {
  onParsed: (rows: OrderRow[], filename: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const process = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/routerizador/parse", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Erro ao processar arquivo");
      onParsed(data.rows as OrderRow[], file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onParsed]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) process(file);
  };

  return (
    <section style={{ maxWidth: 540, margin: "0 auto", padding: "32px 0" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 18, background: "rgba(16,185,129,.14)", color: "var(--green)", marginBottom: 16 }}>
          <FileSpreadsheet size={32} />
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 22, letterSpacing: "-.02em" }}>Importar Carteira de Pedidos</h2>
        <p style={{ color: "var(--muted)", fontSize: 14, margin: 0, lineHeight: 1.55 }}>
          Faça upload da sua planilha <strong>.xlsx</strong> ou <strong>.csv</strong>, ou arquivo NOTFIS EDI (<strong>.txt</strong>, <strong>.not</strong>, <strong>.edi</strong>).<br />
          O sistema detecta automaticamente colunas ou posições EDI de cidade, cubagem, peso e cliente.
        </p>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => fileRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--green)" : "var(--line)"}`,
          borderRadius: 18,
          padding: "48px 32px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "rgba(16,185,129,.05)" : "var(--card)",
          transition: "all .2s ease",
          outline: "none",
        }}
      >
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--muted)", pointerEvents: "none" }}>
            <Loader2 size={32} className="spin" style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ fontSize: 14 }}>Processando arquivo...</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, pointerEvents: "none" }}>
            <Upload size={28} color="var(--muted)" />
            <div>
              <p style={{ margin: "0 0 4px", fontWeight: 700, color: "var(--ink)" }}>Clique ou arraste o arquivo aqui</p>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Suporta .xlsx, .csv e NOTFIS EDI (.txt / .not / .edi)</p>
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt,.not,.edi" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) process(f); e.target.value = ""; }} />
      </div>

      {error && (
        <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 12, background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", color: "var(--red)", fontSize: 14, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          {error}
        </div>
      )}

      <div style={{ marginTop: 24, padding: 16, borderRadius: 14, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
        <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>Formatos e colunas suportadas</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["NOTFIS Proceda (EDI)", "Cidade / Município", "Cliente / Destinatário", "Pedido / NF", "Cubagem (m³)", "Peso (kg)", "Caixas / Volumes"].map(col => (
            <span key={col} style={{ padding: "4px 10px", borderRadius: 8, background: col.includes("NOTFIS") ? "rgba(16,185,129,.15)" : "var(--card)", border: `1px solid ${col.includes("NOTFIS") ? "rgba(16,185,129,.3)" : "var(--line)"}`, fontSize: 12, color: col.includes("NOTFIS") ? "var(--green)" : "var(--ink)", fontWeight: col.includes("NOTFIS") ? 700 : 400 }}>{col}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Step 2: Config & Preview ────────────────────────────────────────────────

function ConfigStep({
  rows,
  filename,
  onGenerate,
  onBack,
}: {
  rows: OrderRow[];
  filename: string;
  onGenerate: (result: EngineResult, config: EngineConfig) => void;
  onBack: () => void;
}) {
  const [maxVol, setMaxVol] = useState(30);
  const [maxWt, setMaxWt] = useState(10000);
  const [radius, setRadius] = useState(80);
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const byCity = new Map<string, number>();
  for (const r of rows) {
    byCity.set(r.city, (byCity.get(r.city) ?? 0) + 1);
  }
  const totalVol = rows.reduce((s, r) => s + r.volumeM3, 0);
  const totalWt  = rows.reduce((s, r) => s + r.weightKg, 0);

  const generate = async () => {
    setLoading(true);
    setError("");
    try {
      const config: Partial<EngineConfig> = { maxVolumeM3: maxVol, maxWeightKg: maxWt, clusterRadiusKm: radius, routeDate };
      const result = await api<EngineResult>("/api/routerizador/generate", {
        method: "POST",
        body: JSON.stringify({ rows, config }),
      });
      onGenerate(result, { ...config, originName: "Filial", originLat: -7.2306, originLng: -35.8811 } as EngineConfig);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section>
      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Pedidos", value: rows.length, unit: "" },
          { label: "Cidades", value: byCity.size, unit: "" },
          { label: "Volume Total", value: fmt(totalVol), unit: "m³" },
          { label: "Peso Total", value: fmt(totalWt, 0), unit: "kg" },
        ].map(({ label, value, unit }) => (
          <div key={label} style={{ padding: "14px 16px", borderRadius: 14, background: "var(--card)", border: "1px solid var(--line)" }}>
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 900, letterSpacing: "-.03em" }}>{value} <span style={{ fontSize: 13, color: "var(--muted)" }}>{unit}</span></p>
          </div>
        ))}
      </div>

      {/* Config */}
      <div style={{ padding: 20, borderRadius: 16, background: "var(--card)", border: "1px solid var(--line)", marginBottom: 20 }}>
        <p style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 14 }}>⚙️ Configuração do Veículo</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>Capacidade máx. m³</span>
            <input type="number" min={1} max={200} value={maxVol} onChange={(e) => setMaxVol(Number(e.target.value))}
              style={{ background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>Capacidade máx. kg</span>
            <input type="number" min={100} max={100000} value={maxWt} onChange={(e) => setMaxWt(Number(e.target.value))}
              style={{ background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>Raio de agrupamento (km)</span>
            <input type="number" min={10} max={500} value={radius} onChange={(e) => setRadius(Number(e.target.value))}
              style={{ background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>Data da entrega</span>
            <input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)}
              style={{ background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px" }} />
          </label>
        </div>
      </div>

      <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
        Arquivo: <strong style={{ color: "var(--ink)" }}>{filename}</strong> · {rows.length} pedidos em {byCity.size} cidades
      </p>
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>⚠ {error}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>
          <ArrowLeft size={16} /> Voltar
        </button>
        <button onClick={generate} disabled={loading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 12, border: "none", background: "var(--green)", color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 14, opacity: loading ? .7 : 1 }}>
          {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={16} />}
          {loading ? "Gerando rotas..." : "Gerar Rotas Automáticas"}
        </button>
      </div>
    </section>
  );
}

// ─── Step 3: Review ─────────────────────────────────────────────────────────

function ReviewStep({
  result,
  filename,
  routeDate,
  engineConfig,
  onBack,
  onDispatched,
  onOpenInPlanner,
}: {
  result: EngineResult;
  filename: string;
  routeDate: string;
  engineConfig?: EngineConfig | null;
  onBack: () => void;
  onDispatched: (routeIds: string[]) => void;
  onOpenInPlanner?: (route: SuggestedRoute, config?: EngineConfig | null) => void;
}) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Record<number, { driverId: string; vehicleId: string }>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState("");

  // Load drivers + vehicles
  useState(() => {
    Promise.all([
      api<Driver[]>("/api/drivers").catch(() => [] as Driver[]),
      api<Vehicle[]>("/api/vehicles").catch(() => [] as Vehicle[]),
    ]).then(([d, v]) => {
      setDrivers(d.filter(x => x.active !== false));
      setVehicles(v.filter(x => x.active !== false));
    }).finally(() => setLoadingData(false));
  });

  const toggle = (idx: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const assign = (routeIdx: number, field: "driverId" | "vehicleId", val: string) => {
    setAssignments(prev => ({ ...prev, [routeIdx]: { ...prev[routeIdx], [field]: val } }));
  };

  const dispatch = async () => {
    setLoading(true);
    setError("");
    try {
      const routes = result.routes.map((suggested) => ({
        suggested,
        driverId: assignments[suggested.index]?.driverId ?? "",
        vehicleId: assignments[suggested.index]?.vehicleId ?? "",
      }));
      const res = await api<{ routeIds: string[] }>("/api/routerizador/dispatch", {
        method: "POST",
        body: JSON.stringify({ routes, routeDate, importFilename: filename }),
      });
      onDispatched(res.routeIds);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const assignedCount = result.routes.filter(r => assignments[r.index]?.driverId).length;

  return (
    <section>
      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }}>
        {[
          { label: "Rotas Geradas", value: result.stats.totalRoutes, color: "var(--ink)" },
          { label: "Pedidos", value: result.stats.totalOrders, color: "var(--ink)" },
          { label: "Volume Total", value: `${fmt(result.stats.totalVolumeM3)} m³`, color: "var(--ink)" },
          { label: "Ocupação Média", value: `${result.stats.avgOccupancyPct}%`, color: result.stats.avgOccupancyPct > 85 ? "var(--red)" : "var(--green)" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: "12px 14px", borderRadius: 13, background: "var(--card)", border: "1px solid var(--line)" }}>
            <p style={{ margin: "0 0 3px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</p>
            <p style={{ margin: 0, fontSize: 20, fontWeight: 900, color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Route cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 20 }}>
        {result.routes.map((route) => {
          const asgn = assignments[route.index] ?? {};
          const isOpen = expanded.has(route.index - 1);
          return (
            <div key={route.index} style={{ borderRadius: 16, border: "1px solid var(--line)", background: "var(--card)", overflow: "hidden" }}>
              {/* Header */}
              <div
                style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
                onClick={() => {
                  if (onOpenInPlanner) {
                    onOpenInPlanner(route, engineConfig);
                  } else {
                    toggle(route.index - 1);
                  }
                }}
              >
                <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: "50%", background: "rgba(16,185,129,.15)", color: "var(--green)", fontWeight: 900, fontSize: 14, flexShrink: 0 }}>
                  {route.index}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{route.name}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>{route.totalOrders} pedidos · {route.stops.length} paradas · {fmt(route.totalVolumeM3)} m³</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {onOpenInPlanner && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenInPlanner(route, engineConfig);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "5px 10px",
                        borderRadius: 8,
                        background: "rgba(16,185,129,0.12)",
                        color: "var(--green)",
                        border: "1px solid rgba(16,185,129,0.3)",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                      title="Abrir esta rota diretamente no mapa interativo para conferir e editar paradas"
                    >
                      <MapPin size={13} />
                      <span>Revisar no Mapa</span>
                    </button>
                  )}
                  {route.warning && <Badge text="⚠ Alto" color="amber" />}
                  {asgn.driverId && <Badge text="✓ Atribuído" color="green" />}
                  <OccupancyBar pct={route.occupancyPct} warning={route.warning} />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(route.index - 1);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "4px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title={isOpen ? "Recolher detalhes" : "Ver manifesto e atribuição"}
                  >
                    {isOpen ? <ChevronUp size={16} color="var(--muted)" /> : <ChevronDown size={16} color="var(--muted)" />}
                  </button>
                </div>
              </div>

              {/* Expanded */}
              {isOpen && (
                <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--line)" }}>
                  {/* Quick action bar inside card */}
                  {onOpenInPlanner && (
                    <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => onOpenInPlanner(route, engineConfig)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "7px 14px",
                          borderRadius: 9,
                          background: "var(--green)",
                          color: "#fff",
                          border: "none",
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        <MapPin size={14} /> Abrir e Revisar no Mapa Interativo
                      </button>
                    </div>
                  )}

                  {/* LIFO order */}
                  <div style={{ marginTop: 14, marginBottom: 14 }}>
                    <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                      📦 Ordem de Carregamento (LIFO — última entrega = carregada primeiro)
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {[...route.stops].sort((a, b) => a.loadingSequence - b.loadingSequence).map((stop) => (
                        <div key={stop.position} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
                          <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: "50%", background: "var(--navy)", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                            {stop.loadingSequence}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>{stop.city}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                              {stop.clientName || "—"} · {fmt(stop.volumeM3)} m³ · {stop.boxes} cx
                            </p>
                            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                              Pedidos: {stop.orders.map(o => o.orderId).join(", ")}
                            </p>
                          </div>
                          <Badge text={`Entrega ${stop.position}`} color="muted" />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Driver + Vehicle assignment */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em", display: "flex", alignItems: "center", gap: 4 }}>
                        <Truck size={12} /> Motorista
                      </span>
                      <select value={asgn.driverId ?? ""} onChange={(e) => assign(route.index, "driverId", e.target.value)}
                        style={{ background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px" }}>
                        <option value="">— Selecionar motorista —</option>
                        {loadingData ? <option disabled>Carregando...</option> : drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".08em", display: "flex", alignItems: "center", gap: 4 }}>
                        <Package size={12} /> Veículo
                      </span>
                      <select value={asgn.vehicleId ?? ""} onChange={(e) => assign(route.index, "vehicleId", e.target.value)}
                        style={{ background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px" }}>
                        <option value="">— Selecionar veículo —</option>
                        {loadingData ? <option disabled>Carregando...</option> : vehicles.map(v => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Unassigned */}
      {result.unassigned.length > 0 && (
        <div style={{ padding: 14, borderRadius: 13, background: "rgba(239,68,68,.07)", border: "1px dashed rgba(239,68,68,.35)", marginBottom: 16 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 700, color: "var(--red)", fontSize: 13 }}>⚠ {result.unassigned.length} pedidos sem coordenadas conhecidas</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Estes pedidos não foram incluídos nas rotas pois a cidade não foi reconhecida no dicionário geográfico.</p>
        </div>
      )}

      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>⚠ {error}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px", borderRadius: 12, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}>
          <ArrowLeft size={16} /> Reconfigurar
        </button>
        <button onClick={dispatch} disabled={loading || assignedCount === 0} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 22px", borderRadius: 12, border: "none", background: assignedCount === 0 ? "var(--line)" : "var(--green)", color: assignedCount === 0 ? "var(--muted)" : "#fff", cursor: assignedCount === 0 ? "not-allowed" : "pointer", fontWeight: 700, fontSize: 14 }}>
          {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
          {loading ? "Salvando rotas..." : `Despachar ${assignedCount} de ${result.routes.length} rotas`}
        </button>
        {assignedCount === 0 && <span style={{ fontSize: 12, color: "var(--muted)" }}>Atribua ao menos um motorista para despachar</span>}
      </div>
    </section>
  );
}

// ─── Step 4: Success ─────────────────────────────────────────────────────────

function SuccessStep({ routeIds, onNew }: { routeIds: string[]; onNew: () => void }) {
  return (
    <section style={{ maxWidth: 480, margin: "0 auto", padding: "48px 0", textAlign: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: "50%", background: "rgba(16,185,129,.15)", color: "var(--green)", marginBottom: 20 }}>
        <CheckCircle2 size={36} />
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>Rotas despachadas com sucesso!</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 24px", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--ink)" }}>{routeIds.length} rotas</strong> foram criadas e atribuídas aos motoristas.<br />
        Eles já podem acessar as viagens no aplicativo.
      </p>
      <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
        <button onClick={onNew} style={{ padding: "10px 20px", borderRadius: 12, border: "none", background: "var(--green)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
          Nova Importação
        </button>
      </div>
    </section>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

type Step = "upload" | "config" | "review" | "done";

export default function RoteirizadorPage({
  onBack,
  onOpenInPlanner,
}: {
  onBack?: () => void;
  onOpenInPlanner?: (route: SuggestedRoute, config?: EngineConfig | null) => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [filename, setFilename] = useState("");
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [engineConfig, setEngineConfig] = useState<EngineConfig | null>(null);
  const [dispatchedIds, setDispatchedIds] = useState<string[]>([]);

  const reset = () => {
    setStep("upload");
    setRows([]);
    setFilename("");
    setEngineResult(null);
    setEngineConfig(null);
    setDispatchedIds([]);
  };

  const steps = [
    { key: "upload", label: "1. Upload" },
    { key: "config", label: "2. Configurar" },
    { key: "review", label: "3. Revisar" },
    { key: "done", label: "4. Concluído" },
  ];
  const stepIdx = steps.findIndex(s => s.key === step);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--paper)", color: "var(--ink)" }}>
      {/* Header */}
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", gap: 16, height: 60 }}>
          {onBack && (
            <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
              <ArrowLeft size={15} /> Voltar
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FileSpreadsheet size={20} color="var(--green)" />
            <b style={{ fontSize: 16, letterSpacing: "-.02em" }}>Roteirizador Automático</b>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <a
              href="/ROTEIRIZADOR_ENTREGAS_FUNCIONAL.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
                background: "var(--card-subtle)",
                color: "var(--ink)",
                textDecoration: "none",
                fontSize: 12,
                fontWeight: 600,
              }}
              title="Abrir versão alternativa completa do roteirizador em nova aba"
            >
              🚀 Roteirizador Avançado (Nova Guia)
            </a>
            {step !== "done" && (
              <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 12 }}>
                <X size={13} /> Reiniciar
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Progress */}
      <div style={{ borderBottom: "1px solid var(--line)", background: "var(--card-subtle)", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", gap: 4 }}>
          {steps.map((s, i) => (
            <div key={s.key} style={{ padding: "10px 14px", fontSize: 12, fontWeight: 700, color: i <= stepIdx ? "var(--green)" : "var(--muted)", borderBottom: i === stepIdx ? "2px solid var(--green)" : "2px solid transparent", transition: "all .2s" }}>
              {s.label}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {step === "upload" && (
          <UploadStep onParsed={(r, f) => { setRows(r); setFilename(f); setStep("config"); }} />
        )}
        {step === "config" && (
          <ConfigStep
            rows={rows}
            filename={filename}
            onBack={() => setStep("upload")}
            onGenerate={(result, config) => { setEngineResult(result); setEngineConfig(config); setStep("review"); }}
          />
        )}
        {step === "review" && engineResult && (
          <ReviewStep
            result={engineResult}
            filename={filename}
            routeDate={engineConfig?.routeDate ?? new Date().toISOString().slice(0, 10)}
            engineConfig={engineConfig}
            onBack={() => setStep("config")}
            onDispatched={(ids) => { setDispatchedIds(ids); setStep("done"); }}
            onOpenInPlanner={onOpenInPlanner}
          />
        )}
        {step === "done" && (
          <SuccessStep routeIds={dispatchedIds} onNew={reset} />
        )}
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
