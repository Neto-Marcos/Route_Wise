"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  RotateCcw,
  Send,
  Truck,
  Upload,
  X,
} from "lucide-react";
import type { SuggestedRoute, EngineResult, EngineConfig } from "@/lib/route-engine";
import { parseSpreadsheet, type OrderRow } from "@/lib/spreadsheet-parser";
import {
  STATE_MIN_ORDER_VALUE,
  checkOrderMinEligibility,
  getMinOrderValueForState,
  type MinOrderCheckResult,
} from "@/lib/business-rules";

// ─── Constants ────────────────────────────────────────────────────────────────

const VEHICLE_PRESETS: Record<string, { label: string; maxVol: number; maxWt: number }> = {
  tresquartos: { label: "3/4 — 40 m³", maxVol: 40, maxWt: 8000 },
  toco: { label: "Toco — 50 m³", maxVol: 50, maxWt: 12000 },
  truck: { label: "Truck — 70 m³", maxVol: 70, maxWt: 15000 },
  carreta: { label: "Carreta — 95 m³", maxVol: 95, maxWt: 27000 },
  bitrem: { label: "Bitrem — 140 m³", maxVol: 140, maxWt: 40000 },
  custom: { label: "Personalizado", maxVol: 90, maxWt: 20000 },
};

const NE_STATES = ["AL", "AP", "BA", "CE", "MA", "PA", "PB", "PE", "PI", "RN", "SE", "TO"];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Driver { id: string; name: string; phone?: string; active?: boolean; }
interface Vehicle { id: string; name: string; plate: string; capacity_m3?: number; active?: boolean; }
type FreightFilter = "Todos" | "CIF" | "FOB";

interface RouteViability {
  label: "Viável" | "Atenção" | "Inviável";
  color: string;
  bg: string;
  border: string;
  reasons: string[];
}

// ─── Util ─────────────────────────────────────────────────────────────────────

async function api<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmt(n: number, dec = 2) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function getFreightType(row: OrderRow): string {
  const raw = row.freightType ?? row.extra?.["tipo frete"] ?? row.extra?.["tipo_frete"] ?? row.extra?.["frete"] ?? "";
  return String(raw).trim().toUpperCase();
}

function getRowValue(row: OrderRow): number {
  if (typeof row.totalValue === "number" && !isNaN(row.totalValue) && row.totalValue > 0) {
    return row.totalValue;
  }
  const raw = row.extra?.["total item"] ?? row.extra?.["total_item"] ?? row.extra?.["valor"] ?? row.extra?.["vlr total"] ?? row.extra?.["valor total"] ?? "0";
  const s = String(raw).replace(/[^\d,.-]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

function filterByFreight(rows: OrderRow[], filter: FreightFilter): OrderRow[] {
  if (filter === "Todos") return rows;
  return rows.filter(r => { const ft = getFreightType(r); return ft === filter || ft.startsWith(filter); });
}

function estimateRouteHours(stops: number, distKm: number, speedKmh: number, serviceMin: number): string {
  const driveH = distKm / speedKmh;
  const serviceH = (stops * serviceMin) / 60;
  const total = driveH + serviceH;
  const h = Math.floor(total);
  const m = Math.round((total - h) * 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

function RoutePointMap({ route, selectedStop }: { route: SuggestedRoute; selectedStop: SuggestedRoute["stops"][number] | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!mounted || !containerRef.current) return;
      mapRef.current?.remove();
      const focus = selectedStop ?? route.stops[0];
      if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lng)) return;
      if ((containerRef.current as any)._leaflet_id) {
        delete (containerRef.current as any)._leaflet_id;
      }
      const map = L.map(containerRef.current, { zoomControl: true }).setView([focus.lat, focus.lng], 10);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
      route.stops.forEach((stop) => {
        const active = stop.position === focus.position;
        L.circleMarker([stop.lat, stop.lng], { radius: active ? 12 : 7, color: active ? "#f59e0b" : "#38bdf8", fillColor: active ? "#f59e0b" : "#38bdf8", fillOpacity: .92, weight: 3 }).addTo(map)
          .bindPopup(`<strong>${stop.position}ª entrega · ${stop.city}</strong><br/>${stop.clientName || "Cliente"}`);
      });
    })();
    return () => { mounted = false; mapRef.current?.remove(); mapRef.current = null; };
  }, [route, selectedStop]);
  return <div ref={containerRef} style={{ height: 280, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(56,189,248,.25)", marginBottom: 12 }} />;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateDistanceKm(stops: SuggestedRoute["stops"], originLat: number, originLng: number): number {
  let dist = 0;
  let prevLat = originLat;
  let prevLng = originLng;
  for (const s of stops) {
    if (s.lat && s.lng) {
      dist += haversineKm(prevLat, prevLng, s.lat, s.lng);
      prevLat = s.lat;
      prevLng = s.lng;
    }
  }
  return Math.round(dist);
}

function getRouteRegion(route: SuggestedRoute): string {
  const states = new Set<string>();
  for (const stop of route.stops) {
    for (const order of stop.orders) {
      if (order.uf) states.add(order.uf.trim().toUpperCase());
    }
    const m = stop.city.match(/\/([A-Z]{2})$/);
    if (m) states.add(m[1]);
  }
  return Array.from(states).join(" / ") || "—";
}

function getRouteOrderIds(route: SuggestedRoute): string[] {
  const ids = new Set<string>();
  for (const stop of route.stops) {
    for (const o of stop.orders) ids.add(o.orderId);
  }
  return Array.from(ids);
}

function getRouteValue(route: SuggestedRoute): number {
  let total = 0;
  for (const stop of route.stops) {
    for (const o of stop.orders) total += getRowValue(o);
  }
  return total;
}

/**
 * Avaliação automática de viabilidade da rota.
 * Critérios:
 * - Ocupação < 30% → Inviável (muito vazia)
 * - Ocupação > 98% → Atenção (sobre-carregada)
 * - Custo % sobre valor > 8% → Inviável (frete caro demais)
 * - Custo % sobre valor entre 5-8% → Atenção
 * - KM > 3000 → Inviável (distância excessiva)
 * - Menos de 2 paradas → Atenção
 * - Volume < 10 m³ → Inviável (dedicação muito baixa)
 */
function assessViability(
  route: SuggestedRoute,
  distKm: number,
  value: number,
  costPct: number,
  minVolDed: number,
): RouteViability {
  const reasons: string[] = [];
  let score = 100;

  if (route.occupancyPct < 30) {
    reasons.push(`Ocupação ${route.occupancyPct}% abaixo do mínimo`);
    score -= 50;
  } else if (route.occupancyPct > 98) {
    reasons.push("Sobre-carregada (>98% capacidade)");
    score -= 20;
  }

  if (route.totalVolumeM3 < minVolDed && minVolDed > 0) {
    reasons.push(`Volume ${fmt(route.totalVolumeM3)} m³ abaixo do mínimo dedicado ${minVolDed} m³`);
    score -= 30;
  }

  if (value > 0) {
    const actualCostPct = (costPct / 100) * value;
    const freightRatio = (actualCostPct / value) * 100;
    if (freightRatio > 8) {
      reasons.push(`Custo do frete ${freightRatio.toFixed(1)}% sobre valor (>8%)`);
      score -= 40;
    } else if (freightRatio > 5) {
      reasons.push(`Custo do frete ${freightRatio.toFixed(1)}% sobre valor (5-8%)`);
      score -= 15;
    }
  }

  if (distKm > 3000) {
    reasons.push(`Distância ${distKm.toLocaleString("pt-BR")} km excessiva (>3000 km)`);
    score -= 40;
  } else if (distKm > 1500) {
    reasons.push(`Distância ${distKm.toLocaleString("pt-BR")} km elevada`);
    score -= 10;
  }

  if (route.stops.length < 2) {
    reasons.push("Apenas 1 parada (considere rota dedicada simples)");
    score -= 15;
  }

  if (score >= 75) {
    return { label: "Viável", color: "#10b981", bg: "rgba(16,185,129,.12)", border: "rgba(16,185,129,.25)", reasons: reasons.length ? reasons : ["Rota dentro dos parâmetros configurados"] };
  } else if (score >= 40) {
    return { label: "Atenção", color: "#f59e0b", bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.25)", reasons };
  } else {
    return { label: "Inviável", color: "#ef4444", bg: "rgba(239,68,68,.12)", border: "rgba(239,68,68,.25)", reasons };
  }
}

function gmapsUrl(route: SuggestedRoute, originName: string): string {
  const origin = encodeURIComponent(originName + ", Brasil");
  const stops = route.stops;
  if (!stops.length) return "#";
  const dest = encodeURIComponent(stops[stops.length - 1]?.city + ", Brasil");
  const waypoints = stops.slice(0, -1).map(s => encodeURIComponent(s.city + ", Brasil")).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${waypoints ? `&waypoints=${waypoints}` : ""}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  card: { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 14, padding: "16px 20px" } as React.CSSProperties,
  label: { fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".08em", display: "block", marginBottom: 5 },
  input: { background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 12px", fontSize: 13, width: "100%", boxSizing: "border-box" as const },
  select: { background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)", borderRadius: 9, padding: "9px 12px", fontSize: 13, width: "100%", cursor: "pointer" },
  btnPrimary: { display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 10, border: "none", background: "var(--green)", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" } as React.CSSProperties,
  btnSecondary: { display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 16px", borderRadius: 10, border: "1px solid var(--line)", background: "transparent", color: "var(--muted)", fontWeight: 600, fontSize: 13, cursor: "pointer" } as React.CSSProperties,
} as const;

// ─── OccupancyBar ─────────────────────────────────────────────────────────────

function OccupancyBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "#ef4444" : pct >= 75 ? "#f59e0b" : "#38bdf8";
  return (
    <div style={{ minWidth: 100 }}>
      <div style={{ height: 6, background: "rgba(255,255,255,.1)", borderRadius: 999, overflow: "hidden", marginBottom: 3 }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 999 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color }}>{pct}%</span>
    </div>
  );
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function UploadStep({ onParsed }: { onParsed: (rows: OrderRow[], filename: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedWorkbook, setSavedWorkbook] = useState<{ filename: string; rows: OrderRow[]; updatedAt: string } | null>(null);

  useEffect(() => {
    fetch("/api/routerizador/workbook").then(r => r.ok ? r.json() : null).then(data => setSavedWorkbook(data?.workbook ?? null)).catch(() => {});
  }, []);

  const process = useCallback(async (file: File) => {
    setLoading(true); setError("");
    try {
      let rows: OrderRow[] = [];
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/routerizador/workbook", { method: "POST", body: form });
        if (res.ok) { const data = await res.json(); rows = data.rows ?? []; setSavedWorkbook({ filename: data.filename, rows, updatedAt: new Date().toISOString() }); }
      } catch { /* fall through */ }
      if (!rows.length) {
        const buf = await file.arrayBuffer();
        rows = await parseSpreadsheet(buf, file.name);
      }
      if (!rows.length) throw new Error("Nenhum pedido encontrado. Verifique se a planilha tem colunas: Cidade, Cliente, Pedido, Volume.");
      onParsed(rows, file.name);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [onParsed]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) process(file);
  }, [process]);

  return (
    <div style={{ maxWidth: 560, margin: "60px auto" }}>
      {savedWorkbook && (
        <div style={{ ...S.card, marginBottom: 14, borderColor: "rgba(16,185,129,.35)" }}>
          <strong style={{ color: "var(--green)" }}>Carteira atual salva</strong>
          <p style={{ margin: "6px 0", fontSize: 13 }}>{savedWorkbook.filename} · {savedWorkbook.rows.length} pedidos</p>
          <button type="button" onClick={() => onParsed(savedWorkbook.rows, savedWorkbook.filename)} style={S.btnPrimary}>Usar carteira salva</button>
          <small style={{ display: "block", marginTop: 8, color: "var(--muted)" }}>Envie outra planilha abaixo para substituir esta carteira.</small>
        </div>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{ border: `2px dashed ${dragging ? "var(--green)" : "var(--line)"}`, borderRadius: 18, padding: "52px 32px", textAlign: "center", cursor: "pointer", background: dragging ? "rgba(16,185,129,.06)" : "var(--card)", transition: "all .2s" }}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.xlsm,.not,.edi,.txt" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) process(f); e.target.value = ""; }} />
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, pointerEvents: "none" }}>
            <Loader2 size={40} color="var(--green)" style={{ animation: "spin 1s linear infinite" }} />
            <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>Lendo planilha...</p>
          </div>
        ) : (
          <div style={{ pointerEvents: "none" }}>
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(16,185,129,.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <Upload size={28} color="var(--green)" />
            </div>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 16 }}>Importar Planilha Sabium</p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Arraste ou clique · .xlsx, .xls, .csv</p>
          </div>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, color: "#ef4444", fontSize: 13 }}>{error}</p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Config ───────────────────────────────────────────────────────────

function ConfigStep({ rows, filename, onBack, onGenerate }: {
  rows: OrderRow[];
  filename: string;
  onBack: () => void;
  onGenerate: (result: EngineResult, config: EngineConfig, vehicle: string, svcMin: number, speedKmh: number, costMin: number, costMax: number, minVol: number, ff: FreightFilter) => void;
}) {
  const [freightFilter, setFreightFilter] = useState<FreightFilter>("Todos");
  const [preset, setPreset] = useState("carreta");
  const [maxVol, setMaxVol] = useState(95);
  const [maxWt, setMaxWt] = useState(27000);
  // Parâmetros operacionais estáveis: mantidos no motor, sem poluir a tela.
  const minVolDed = 20;
  const costPctMin = 3;
  const costPctMax = 5;
  const speedKmh = 52;
  const serviceMin = 40;
  const maxHours = 84;
  const [states, setStates] = useState<Set<string>>(new Set(["Todos"]));
  const [prioritizeOld, setPrioritizeOld] = useState(true);
  const [searchOnline, setSearchOnline] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [configOpen, setConfigOpen] = useState(true);

  const [enforceMinOrderValue, setEnforceMinOrderValue] = useState(true);
  const [showBelowMinModal, setShowBelowMinModal] = useState(false);

  const applyPreset = (key: string) => {
    setPreset(key);
    if (key !== "custom") { const p = VEHICLE_PRESETS[key]; setMaxVol(p.maxVol); setMaxWt(p.maxWt); }
  };

  const toggleState = (uf: string) => {
    setStates(prev => {
      const next = new Set(prev);
      if (uf === "Todos") return new Set(["Todos"]);
      next.delete("Todos");
      if (next.has(uf)) next.delete(uf); else next.add(uf);
      return next.size === 0 ? new Set(["Todos"]) : next;
    });
  };

  const filtered = filterByFreight(rows, freightFilter);
  const cifCount = rows.filter(r => getFreightType(r) === "CIF").length;
  const fobCount = rows.filter(r => getFreightType(r) === "FOB").length;
  const uniqueCities = new Set(filtered.map(r => r.city)).size;
  const totalVol = filtered.reduce((s, r) => s + r.volumeM3, 0);

  const belowMinOrders = useMemo(() => {
    return filtered.filter(order => {
      const check = checkOrderMinEligibility(order);
      return !check.eligible;
    });
  }, [filtered]);

  const generate = async () => {
    setLoading(true); setError("");
    try {
      const rowsInSelectedStates = states.has("Todos")
        ? filtered
        : filtered.filter(row => states.has((row.uf ?? "").trim().toUpperCase()));
      const hasFreightData = rowsInSelectedStates.some(row => Boolean(getFreightType(row)));
      // FOB is a client pickup. It is visible for review, but is never sent to
      // the company-fleet routing engine.
      const routableRows = hasFreightData
        ? rowsInSelectedStates.filter(row => getFreightType(row) === "CIF")
        : rowsInSelectedStates;
      if (routableRows.length === 0) {
        throw new Error("Não há pedidos CIF nos estados selecionados para roteirizar com a frota própria.");
      }
      const routeDate = new Date().toISOString().slice(0, 10);
      const fullConfig: EngineConfig = {
        maxVolumeM3: maxVol,
        maxWeightKg: maxWt,
        clusterRadiusKm: 80,
        routeDate,
        originName: "Campina Grande/PB",
        originLat: -7.2306,
        originLng: -35.8811,
        minVolumeM3: minVolDed,
        prioritizeAging: prioritizeOld,
        returnToOrigin: false,
        averageSpeed: speedKmh,
        serviceMinutes: serviceMin,
        maxHours,
        enforceMinOrderValue,
      };
      const result = await api<EngineResult>("/api/routerizador/generate", { method: "POST", body: JSON.stringify({ rows: routableRows, config: fullConfig }) });
      onGenerate(result, fullConfig, preset, serviceMin, speedKmh, costPctMin, costPctMax, minVolDed, freightFilter);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const reset = () => { applyPreset("carreta"); setStates(new Set(["Todos"])); setPrioritizeOld(true); setSearchOnline(true); };

  return (
    <div>
      <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onBack} style={S.btnSecondary}><ArrowLeft size={15} /> Voltar</button>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          📄 <strong style={{ color: "var(--ink)" }}>{filename}</strong> — <strong>{rows.length}</strong> pedidos · <strong>{new Set(rows.map(r => r.city)).size}</strong> cidades ·
          <strong style={{ color: "#10b981" }}> CIF: {cifCount}</strong> · <strong style={{ color: "#f59e0b" }}> FOB: {fobCount}</strong>
        </span>
      </div>

      {/* CIF/FOB filter */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 13 }}>🚛 Filtro de Tipo de Frete</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {(["Todos", "CIF", "FOB"] as FreightFilter[]).map(f => {
            const active = freightFilter === f;
            const clr = f === "CIF" ? "#10b981" : f === "FOB" ? "#f59e0b" : "var(--green)";
            return (
              <button key={f} onClick={() => setFreightFilter(f)} style={{ padding: "7px 18px", borderRadius: 8, border: `1px solid ${active ? clr : "var(--line)"}`, background: active ? `${clr}22` : "transparent", color: active ? clr : "var(--muted)", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
                {f === "Todos" ? `Todos (${rows.length})` : f === "CIF" ? `CIF (${cifCount})` : `FOB (${fobCount})`}
              </button>
            );
          })}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>
            {filtered.length} pedidos · {uniqueCities} cidades · {fmt(totalVol)} m³
          </span>
        </div>
      </div>

      {/* Regra de Pedido Mínimo por Estado */}
      <div style={{ ...S.card, marginBottom: 14, borderLeft: "4px solid #f59e0b" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>
              📋 Regra de Pedido Mínimo por Estado
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
              PB: <strong style={{ color: "var(--ink)" }}>R$ 1.500</strong> · AL, BA, CE, PE, RN, SE: <strong style={{ color: "var(--ink)" }}>R$ 2.000</strong> · MA, PA, PI, TO: <strong style={{ color: "var(--ink)" }}>R$ 7.000</strong> · AP: <strong style={{ color: "var(--ink)" }}>R$ 10.000</strong>
            </p>
          </div>
          {belowMinOrders.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>
                ⚠ {belowMinOrders.length} {belowMinOrders.length === 1 ? "pedido abaixo" : "pedidos abaixo"} do mínimo
              </span>
              <button
                type="button"
                onClick={() => setShowBelowMinModal(true)}
                style={{ ...S.btnSecondary, padding: "5px 12px", fontSize: 11, background: "rgba(245,158,11,.1)", borderColor: "rgba(245,158,11,.3)", color: "#f59e0b" }}
              >
                Ver pedidos ({belowMinOrders.length})
              </button>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "#10b981", fontWeight: 600 }}>
              ✔ Todos os pedidos atingem o valor mínimo estadual
            </span>
          )}
        </div>
      </div>

      {/* Config */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <button onClick={() => setConfigOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink)", fontWeight: 700, fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span style={{ opacity: .5, fontSize: 10 }}>{configOpen ? "▼" : "▶"}</span>
          Configuração do veículo e cálculo
        </button>
        {configOpen && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 155px), 1fr))", gap: 12, marginBottom: 12 }}>
              <label><span style={S.label}>Veículo</span><select style={S.select} value={preset} onChange={e => applyPreset(e.target.value)}>{Object.entries(VEHICLE_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
            </div>
            {/* States */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={S.label}>Estados incluídos no cálculo</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{states.has("Todos") ? "Todos os estados" : Array.from(states).join(", ")}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Todos", ...NE_STATES].map(uf => {
                  const checked = states.has(uf) || (uf !== "Todos" && states.has("Todos"));
                  const isAll = uf === "Todos";
                  return (
                    <label key={uf} style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 7, border: `1px solid ${checked ? "rgba(16,185,129,.4)" : "var(--line)"}`, background: checked ? "rgba(16,185,129,.08)" : "transparent", cursor: "pointer", fontSize: 12, fontWeight: isAll ? 700 : 600, color: checked ? "var(--ink)" : "var(--muted)" }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleState(uf)} style={{ accentColor: "var(--green)" }} />
                      {uf}
                    </label>
                  );
                })}
              </div>
            </div>
            {/* Options */}
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
              {[
                { label: "Priorizar registros mais antigos", val: prioritizeOld, set: setPrioritizeOld },
                { label: "Buscar coordenadas online quando não cadastrada", val: searchOnline, set: setSearchOnline },
                { label: "Validar e bloquear pedidos abaixo do pedido mínimo estadual", val: enforceMinOrderValue, set: setEnforceMinOrderValue },
              ].map(({ label, val, set }) => (
                <label key={label} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
                  <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} style={{ accentColor: "var(--green)" }} />
                  {label}
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button style={{ ...S.btnPrimary, opacity: loading || !filtered.length ? .65 : 1 }} onClick={generate} disabled={loading || !filtered.length}>
                {loading ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
                {loading ? "Gerando rotas..." : "Aplicar configuração"}
              </button>
              <button style={S.btnSecondary} onClick={reset}><RotateCcw size={14} /> Restaurar padrão</button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {filtered.length === 0 ? "⚠ Nenhum pedido após filtro" : `Configuração aplicada. ${filtered.length} pedidos disponíveis.`}
              </span>
            </div>
          </div>
        )}
      </div>

      {showBelowMinModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 16, maxWidth: 720, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 40px rgba(0,0,0,.4)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Pedidos Abaixo do Pedido Mínimo Estadual</h3>
                <small style={{ color: "var(--muted)" }}>{belowMinOrders.length} pedidos não atingem a meta financeira do estado de entrega</small>
              </div>
              <button type="button" onClick={() => setShowBelowMinModal(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)" }}><X size={18} /></button>
            </div>
            <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--line)", textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: "6px 8px" }}>Pedido</th>
                    <th style={{ padding: "6px 8px" }}>Cliente</th>
                    <th style={{ padding: "6px 8px" }}>Cidade/UF</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Valor Atual</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Mínimo</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Faltante</th>
                  </tr>
                </thead>
                <tbody>
                  {belowMinOrders.map(o => {
                    const check = checkOrderMinEligibility(o);
                    return (
                      <tr key={o.orderId} style={{ borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                        <td style={{ padding: "8px", fontWeight: 700, color: "#38bdf8" }}>{o.orderId}</td>
                        <td style={{ padding: "8px" }}>{o.client}</td>
                        <td style={{ padding: "8px" }}>{o.city} {o.uf ? `(${o.uf})` : ""}</td>
                        <td style={{ padding: "8px", textAlign: "right", color: "#f59e0b", fontWeight: 700 }}>{fmtBRL(check.currentValue)}</td>
                        <td style={{ padding: "8px", textAlign: "right", color: "var(--muted)" }}>{fmtBRL(check.minRequired)}</td>
                        <td style={{ padding: "8px", textAlign: "right", color: "#ef4444", fontWeight: 700 }}>-{fmtBRL(check.difference)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowBelowMinModal(false)} style={S.btnPrimary}>Entendido / Fechar</button>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ padding: "12px 16px", borderRadius: 12, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", color: "#ef4444", fontSize: 13, marginTop: 8 }}>⚠ {error}</div>}
    </div>
  );
}

// ─── Step 3: Results Table ────────────────────────────────────────────────────

function ResultsTable({ result, filename, engineConfig, vehiclePreset, serviceMin, speedKmh, costPctMin, costPctMax, minVolDed, freightFilter, onBack, onDispatched, onOpenInPlanner }: {
  result: EngineResult; filename: string; engineConfig: EngineConfig;
  vehiclePreset: string; serviceMin: number; speedKmh: number;
  costPctMin: number; costPctMax: number; minVolDed: number;
  freightFilter: FreightFilter;
  onBack: () => void; onDispatched: (ids: string[]) => void;
  onOpenInPlanner?: (route: SuggestedRoute, config?: EngineConfig | null) => void;
}) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<Record<number, { driverId: string; vehicleId: string }>>({});
  const [detailRoute, setDetailRoute] = useState<SuggestedRoute | null>(null);
  const [selectedStop, setSelectedStop] = useState<SuggestedRoute["stops"][number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<Driver[]>("/api/drivers").catch(() => [] as Driver[]),
      api<Vehicle[]>("/api/vehicles").catch(() => [] as Vehicle[]),
    ]).then(([d, v]) => { setDrivers(d.filter(x => x.active !== false)); setVehicles(v.filter(x => x.active !== false)); });
  }, []);

  const dispatch = async () => {
    setLoading(true); setError("");
    try {
      const routes = result.routes.map(s => ({ suggested: s, driverId: assignments[s.index]?.driverId ?? "", vehicleId: assignments[s.index]?.vehicleId ?? "" }));
      const res = await api<{ routeIds: string[] }>("/api/routerizador/dispatch", { method: "POST", body: JSON.stringify({ routes, routeDate: engineConfig.routeDate, importFilename: filename }) });
      onDispatched(res.routeIds);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const assignedCount = result.routes.filter(r => assignments[r.index]?.driverId).length;
  const totalValue = result.routes.reduce((s, r) => s + getRouteValue(r), 0);
  const presetLabel = VEHICLE_PRESETS[vehiclePreset]?.label ?? vehiclePreset;

  const TH = ({ children, minW }: { children: React.ReactNode; minW?: number }) => (
    <th style={{ padding: "9px 10px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".07em", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)", background: "var(--card-subtle)", position: "sticky", top: 0, zIndex: 2, minWidth: minW, textAlign: "left" }}>
      {children}
    </th>
  );

  return (
    <div>
      {/* Stats bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14, alignItems: "center" }}>
        <button onClick={onBack} style={S.btnSecondary}><ArrowLeft size={14} /> Reconfigurar</button>
        {[
          { l: "Rotas", v: result.stats.totalRoutes },
          { l: "Pedidos", v: result.stats.totalOrders },
          { l: "Volume", v: `${fmt(result.stats.totalVolumeM3)} m³` },
          { l: "Ocupação média", v: `${result.stats.avgOccupancyPct}%` },
          { l: "Valor total", v: fmtBRL(totalValue) },
          { l: "Veículo", v: presetLabel },
          { l: "Frete", v: freightFilter },
        ].map(({ l, v }) => (
          <div key={l} style={{ padding: "6px 12px", borderRadius: 8, background: "var(--card)", border: "1px solid var(--line)", fontSize: 12 }}>
            <span style={{ color: "var(--muted)" }}>{l}: </span><strong>{v}</strong>
          </div>
        ))}
      </div>

      {result.unassigned.length > 0 && (() => {
        const belowMin = result.unassigned.filter(o => o.extra?.unassignedReason?.includes("mínimo"));
        const others = result.unassigned.filter(o => !o.extra?.unassignedReason?.includes("mínimo"));
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {belowMin.length > 0 && (
              <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(245,158,11,.08)", border: "1px dashed rgba(245,158,11,.4)", fontSize: 13 }}>
                <span style={{ color: "#f59e0b", fontWeight: 700 }}>📋 {belowMin.length} {belowMin.length === 1 ? "pedido retido" : "pedidos retidos"} por valor abaixo do mínimo estadual</span>
                <span style={{ color: "var(--muted)", marginLeft: 6 }}>— PB: R$ 1.500 · AL/BA/CE/PE/RN/SE: R$ 2.000 · MA/PA/PI/TO: R$ 7.000 · AP: R$ 10.000</span>
              </div>
            )}
            {others.length > 0 && (
              <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(239,68,68,.07)", border: "1px dashed rgba(239,68,68,.3)", fontSize: 13 }}>
                <span style={{ color: "#ef4444", fontWeight: 700 }}>⚠ {others.length} {others.length === 1 ? "pedido não roteirizado" : "pedidos não roteirizados"}</span>
                <span style={{ color: "var(--muted)", marginLeft: 6 }}>— cidade sem coordenada confirmada no mapa ou capacidade excedida.</span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Table */}
      <div style={{ borderRadius: 14, overflow: "auto", border: "1px solid var(--line)", marginBottom: 16, maxHeight: "62vh" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: "var(--card)", color: "var(--ink)", fontSize: 12 }}>
          <thead>
            <tr>
              <TH minW={80}>Rota</TH>
              <TH minW={150}>Ações</TH>
              <TH minW={190}>Atribuição (Motorista / Veículo)</TH>
              <TH minW={80}>Região/Eixo</TH>
              <TH minW={200}>Sequência sugerida</TH>
              <TH minW={70}>Entregas</TH>
              <TH minW={65}>Pedidos</TH>
              <TH minW={65}>M³</TH>
              <TH minW={120}>Ocupação</TH>
              <TH minW={115}>Valor</TH>
              <TH minW={100}>Custo base</TH>
              <TH minW={100}>KM planejado</TH>
              <TH minW={90}>Tempo oper.</TH>
              <TH minW={110}>Custo {costPctMin}%</TH>
              <TH minW={110}>Custo {costPctMax}%</TH>
              <TH minW={100}>Nº Pedidos</TH>
              <TH minW={130}>Viabilidade</TH>
            </tr>
          </thead>
          <tbody>
            {result.routes.map((route) => {
              const region = getRouteRegion(route);
              const orderIds = getRouteOrderIds(route);
              const value = getRouteValue(route);
              const distKm = estimateDistanceKm(route.stops, engineConfig.originLat, engineConfig.originLng);
              const tempoStr = estimateRouteHours(route.stops.length, distKm, speedKmh, serviceMin);
              const cost3 = value * (costPctMin / 100);
              const cost5 = value * (costPctMax / 100);
              const viability = assessViability(route, distKm, value, cost5, minVolDed);
              const asgn = assignments[route.index] ?? {};
              const isDetail = detailRoute?.index === route.index;

              return (
                <tr key={route.index}
                  style={{ borderBottom: "1px solid rgba(255,255,255,.05)", background: isDetail ? "rgba(56,189,248,.05)" : "transparent", cursor: "default" }}
                  onMouseEnter={e => { if (!isDetail) e.currentTarget.style.background = "rgba(255,255,255,.02)"; }}
                  onMouseLeave={e => { if (!isDetail) e.currentTarget.style.background = "transparent"; }}
                >
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <button onClick={() => { setDetailRoute(isDetail ? null : route); setSelectedStop(isDetail ? null : route.stops[0] ?? null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "#38bdf8", fontWeight: 700, fontSize: 12, padding: 0, textDecoration: "underline" }}>
                      Dedicada {route.index}
                    </button>
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <a href={gmapsUrl(route, engineConfig.originName)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "rgba(16,185,129,.18)", color: "#10b981", border: "1px solid rgba(16,185,129,.3)", fontSize: 11, fontWeight: 700, textDecoration: "none" }}>
                        <ExternalLink size={11} /> Google Maps
                      </a>
                      {onOpenInPlanner && (
                        <button onClick={() => onOpenInPlanner(route, engineConfig)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, background: "rgba(56,189,248,.12)", color: "#38bdf8", border: "1px solid rgba(56,189,248,.25)", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                          <MapPin size={11} /> Detalhes/mapa
                        </button>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", minWidth: 200 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      <select
                        value={asgn.driverId ?? ""}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [route.index]: { ...prev[route.index], driverId: e.target.value },
                          }))
                        }
                        style={{
                          padding: "5px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          background: "var(--card-subtle)",
                          color: "var(--ink)",
                          border: "1px solid var(--line)",
                          cursor: "pointer",
                        }}
                        aria-label={`Motorista da Dedicada ${route.index}`}
                      >
                        <option value="">— Motorista —</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={asgn.vehicleId ?? ""}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [route.index]: { ...prev[route.index], vehicleId: e.target.value },
                          }))
                        }
                        style={{
                          padding: "5px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          background: "var(--card-subtle)",
                          color: "var(--ink)",
                          border: "1px solid var(--line)",
                          cursor: "pointer",
                        }}
                        aria-label={`Veículo da Dedicada ${route.index}`}
                      >
                        <option value="">— Veículo —</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.plate}
                          </option>
                        ))}
                      </select>
                      {asgn.driverId && asgn.vehicleId ? (
                        <span style={{ fontSize: 10, color: "#10b981", fontWeight: 700 }}>
                          ✓ Atribuído
                        </span>
                      ) : asgn.driverId ? (
                        <span style={{ fontSize: 10, color: "#f59e0b" }}>Falta vincular veículo</span>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", color: "var(--muted)", fontSize: 11 }}>{region}</td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <div style={{ fontSize: 11 }}>
                      <div style={{ color: "var(--muted)", fontSize: 10 }}>{engineConfig.originName} →</div>
                      {route.stops.map((stop, i) => (
                        <div key={i} style={{ fontWeight: 700 }}>
                          {stop.city.replace(/, [A-Z]{2}$/, "").toUpperCase()}{i < route.stops.length - 1 ? " →" : ""}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", textAlign: "center", fontWeight: 700 }}>{route.stops.length}</td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", textAlign: "center", fontWeight: 700 }}>{route.totalOrders}</td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", textAlign: "right", fontWeight: 600 }}>{fmt(route.totalVolumeM3)}</td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}><OccupancyBar pct={route.occupancyPct} /></td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontWeight: 700, whiteSpace: "nowrap" }}>
                    {value > 0 ? fmtBRL(value) : <span style={{ color: "var(--muted)" }}>—</span>}
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontSize: 11, color: "var(--muted)" }}>
                    <div>—</div><div style={{ fontSize: 10 }}>Carteira</div><div style={{ fontSize: 10 }}>Estimativa local</div>
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontSize: 11 }}>
                    <div style={{ fontWeight: 700 }}>{distKm > 0 ? `${distKm.toLocaleString("pt-BR")} km` : "—"}</div>
                    <div style={{ color: "var(--muted)", fontSize: 10 }}>Estimativa local</div>
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontWeight: 700 }}>{tempoStr}</td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontSize: 11 }}>
                    {value > 0 ? <><div style={{ fontWeight: 700 }}>{fmtBRL(cost3)}</div><div style={{ color: "var(--muted)", fontSize: 10 }}>{costPctMin}% do valor</div></> : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontSize: 11 }}>
                    {value > 0 ? <><div style={{ fontWeight: 700 }}>{fmtBRL(cost5)}</div><div style={{ color: "var(--muted)", fontSize: 10 }}>{costPctMax}% do valor</div></> : "—"}
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top", fontSize: 10, color: "var(--muted)", lineHeight: 1.7 }}>
                    {orderIds.slice(0, 10).map(id => <div key={id}>{id}</div>)}
                    {orderIds.length > 10 && <div style={{ color: "var(--muted)" }}>+{orderIds.length - 10} mais</div>}
                  </td>
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <div title={viability.reasons.join(" | ")} style={{ display: "inline-block", padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: viability.bg, color: viability.color, border: `1px solid ${viability.border}`, cursor: "help", whiteSpace: "nowrap" }}>
                      {viability.label === "Viável" ? "✅" : viability.label === "Atenção" ? "⚠️" : "❌"} {viability.label}
                    </div>
                    {asgn.driverId && <div style={{ marginTop: 4, fontSize: 10, color: "#10b981" }}>✓ Atribuído</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {detailRoute && (
        <div style={{ marginBottom: 16, padding: "16px 20px", borderRadius: 14, border: "1px solid var(--line)", background: "var(--card)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: "50%", background: "rgba(16,185,129,.15)", color: "#10b981", fontWeight: 900, fontSize: 14 }}>{detailRoute.index}</span>
              <div>
                <p style={{ margin: 0, fontWeight: 700, color: "var(--ink)", fontSize: 14 }}>{detailRoute.name}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>{detailRoute.totalOrders} pedidos · {detailRoute.stops.length} paradas · {fmt(detailRoute.totalVolumeM3)} m³</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {onOpenInPlanner && (
                <button onClick={() => onOpenInPlanner(detailRoute, engineConfig)} style={{ ...S.btnPrimary, fontSize: 12, padding: "7px 14px" }}>
                  <MapPin size={13} /> Abrir e Revisar no Mapa
                </button>
              )}
              <button onClick={() => setDetailRoute(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}><X size={18} /></button>
            </div>
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>
            📦 Ordem de Carregamento (LIFO — última entrega = primeira a carregar)
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>Clique em uma cidade abaixo para localizá-la no mapa.</p>
          <RoutePointMap route={detailRoute} selectedStop={selectedStop} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
            {[...detailRoute.stops].sort((a, b) => a.loadingSequence - b.loadingSequence).map(stop => (
              <div role="button" tabIndex={0} key={stop.position} onClick={() => setSelectedStop(stop)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedStop(stop); }} style={{ display: "flex", width: "100%", textAlign: "left", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderRadius: 9, background: selectedStop?.position === stop.position ? "rgba(245,158,11,.12)" : "var(--card-subtle)", border: selectedStop?.position === stop.position ? "1px solid rgba(245,158,11,.5)" : "1px solid var(--line)", cursor: "pointer", color: "inherit" }}>
                <span style={{ display: "grid", placeItems: "center", width: 24, height: 24, borderRadius: "50%", background: "rgba(56,189,248,.15)", color: "#38bdf8", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{stop.loadingSequence}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "var(--ink)" }}>{stop.city}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>{stop.clientName || "—"} · {fmt(stop.volumeM3)} m³ · {stop.boxes} cx</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>Pedidos: {stop.orders.map(o => o.orderId).join(", ")}</p>
                </div>
                <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>Entrega {stop.position}</span>
              </div>
            ))}
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".1em" }}>Atribuição desta rota</p>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
            <label>
              <span style={{ ...S.label, color: "var(--muted)" }}><Truck size={11} style={{ display: "inline", marginRight: 4 }} />Motorista</span>
              <select value={assignments[detailRoute.index]?.driverId ?? ""} onChange={e => setAssignments(prev => ({ ...prev, [detailRoute.index]: { ...prev[detailRoute.index], driverId: e.target.value } }))} style={{ ...S.select, background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)" }}>
                <option value="">— Selecionar motorista —</option>
                {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label>
              <span style={{ ...S.label, color: "var(--muted)" }}><Package size={11} style={{ display: "inline", marginRight: 4 }} />Veículo</span>
              <select value={assignments[detailRoute.index]?.vehicleId ?? ""} onChange={e => setAssignments(prev => ({ ...prev, [detailRoute.index]: { ...prev[detailRoute.index], vehicleId: e.target.value } }))} style={{ ...S.select, background: "var(--card-subtle)", color: "var(--ink)", border: "1px solid var(--line)" }}>
                <option value="">— Selecionar veículo —</option>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

      {error && <div style={{ padding: "10px 14px", borderRadius: 10, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.25)", color: "#ef4444", fontSize: 13, marginBottom: 12 }}>⚠ {error}</div>}

      {/* Sticky Bottom Action Bar */}
      <div
        style={{
          position: "sticky",
          bottom: 12,
          zIndex: 20,
          padding: "14px 20px",
          borderRadius: 14,
          background: "var(--card)",
          border: "1px solid var(--line)",
          boxShadow: "0 8px 30px rgba(0,0,0,0.3)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginTop: 18,
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 14, color: "var(--ink)" }}>
            {assignedCount} de {result.routes.length} rotas com motorista atribuído
          </strong>
          {assignedCount < result.routes.length && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              (Atribua na tabela acima ou no detalhe da rota)
            </span>
          )}
        </div>
        <button
          onClick={dispatch}
          disabled={loading || assignedCount === 0}
          style={{
            ...S.btnPrimary,
            background: assignedCount === 0 ? "var(--line)" : "#059669",
            color: assignedCount === 0 ? "var(--muted)" : "#fff",
            cursor: assignedCount === 0 ? "not-allowed" : "pointer",
            padding: "10px 22px",
            fontSize: 13,
            fontWeight: 700,
            opacity: loading ? 0.7 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
          {loading ? "Salvando e despachando rotas..." : `Despachar ${assignedCount} ${assignedCount === 1 ? "rota" : "rotas"}`}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Success ──────────────────────────────────────────────────────────

function SuccessStep({ routeIds, onNew }: { routeIds: string[]; onNew: () => void }) {
  return (
    <section style={{ maxWidth: 480, margin: "60px auto", textAlign: "center" }}>
      <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: "50%", background: "rgba(16,185,129,.15)", color: "var(--green)", marginBottom: 20 }}>
        <CheckCircle2 size={36} />
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>Rotas despachadas com sucesso!</h2>
      <p style={{ color: "var(--muted)", margin: "0 0 24px", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--ink)" }}>{routeIds.length} rotas</strong> criadas e atribuídas aos motoristas.<br />
        Eles já podem acessar as viagens no aplicativo.
      </p>
      <button onClick={onNew} style={S.btnPrimary}>Nova Importação</button>
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Step = "upload" | "config" | "review" | "done";

export default function RoteirizadorPage({ onBack, onOpenInPlanner }: {
  onBack?: () => void;
  onOpenInPlanner?: (route: SuggestedRoute, config?: EngineConfig | null) => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [filename, setFilename] = useState("");
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [engineConfig, setEngineConfig] = useState<EngineConfig | null>(null);
  const [vehiclePreset, setVehiclePreset] = useState("carreta");
  const [serviceMin, setServiceMin] = useState(40);
  const [speedKmh, setSpeedKmh] = useState(52);
  const [costPctMin, setCostPctMin] = useState(3);
  const [costPctMax, setCostPctMax] = useState(5);
  const [minVolDed, setMinVolDed] = useState(20);
  const [freightFilter, setFreightFilter] = useState<FreightFilter>("Todos");
  const [dispatchedIds, setDispatchedIds] = useState<string[]>([]);

  const reset = () => { setStep("upload"); setRows([]); setFilename(""); setEngineResult(null); setEngineConfig(null); setDispatchedIds([]); setFreightFilter("Todos"); };

  const steps = [
    { key: "upload", label: "1. Upload" },
    { key: "config", label: "2. Configurar" },
    { key: "review", label: "3. Rotas" },
    { key: "done", label: "4. Concluído" },
  ];
  const stepIdx = steps.findIndex(s => s.key === step);

  return (
    <div className="routing-wizard" style={{ minHeight: "100dvh", background: "var(--paper)", color: "var(--ink)" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--card)", padding: "0 24px" }}>
        <div className="routing-wizard-header" style={{ maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", gap: 14 }}>
          {onBack && <button onClick={onBack} style={S.btnSecondary}><ArrowLeft size={14} /> Voltar</button>}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <FileSpreadsheet size={18} color="var(--green)" />
            <b style={{ fontSize: 15, letterSpacing: "-.02em" }}>Roteirizador Automático</b>
          </div>
          <div style={{ marginLeft: "auto" }}>
            {step !== "done" && <button onClick={reset} style={S.btnSecondary}><X size={12} /> Reiniciar</button>}
          </div>
        </div>
      </header>
      <div style={{ borderBottom: "1px solid var(--line)", background: "var(--card-subtle)", padding: "0 24px" }}>
        <div className="routing-wizard-steps" style={{ maxWidth: 1400, margin: "0 auto", display: "flex" }}>
          {steps.map((s, i) => (
            <div key={s.key} style={{ padding: "9px 14px", fontSize: 12, fontWeight: 700, color: i <= stepIdx ? "var(--green)" : "var(--muted)", borderBottom: i === stepIdx ? "2px solid var(--green)" : "2px solid transparent", transition: "all .2s" }}>
              {s.label}
            </div>
          ))}
        </div>
      </div>
      <main className="routing-wizard-content" style={{ maxWidth: 1400, margin: "0 auto" }}>
        {step === "upload" && <UploadStep onParsed={(r, f) => { setRows(r); setFilename(f); setStep("config"); }} />}
        {step === "config" && (
          <ConfigStep rows={rows} filename={filename} onBack={() => setStep("upload")}
            onGenerate={(result, config, vehicle, svcMin, speed, cMin, cMax, minVol, ff) => {
              setEngineResult(result); setEngineConfig(config); setVehiclePreset(vehicle);
              setServiceMin(svcMin); setSpeedKmh(speed); setCostPctMin(cMin); setCostPctMax(cMax); setMinVolDed(minVol); setFreightFilter(ff); setStep("review");
            }} />
        )}
        {step === "review" && engineResult && engineConfig && (
          <ResultsTable result={engineResult} filename={filename} engineConfig={engineConfig}
            vehiclePreset={vehiclePreset} serviceMin={serviceMin} speedKmh={speedKmh}
            costPctMin={costPctMin} costPctMax={costPctMax} minVolDed={minVolDed}
            freightFilter={freightFilter} onBack={() => setStep("config")}
            onDispatched={(ids) => { setDispatchedIds(ids); setStep("done"); }}
            onOpenInPlanner={onOpenInPlanner} />
        )}
        {step === "done" && <SuccessStep routeIds={dispatchedIds} onNew={reset} />}
      </main>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
