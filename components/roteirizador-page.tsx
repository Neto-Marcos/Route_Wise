"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  GripVertical,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  Send,
  Truck,
  Upload,
  X,
} from "lucide-react";
import type { SuggestedRoute, EngineResult, EngineConfig } from "@/lib/route-engine";
import { type OrderRow } from "@/lib/spreadsheet-parser";
import {
  checkOrderMinEligibility,
} from "@/lib/business-rules";

// ─── Workbook Sync & Stop Reordering Helpers ─────────────────────────────────

export const WORKBOOK_CONFIRMED_EVENT = "criarrota:workbook-confirmed";

export async function previewOperationalWorkbook(
  file: File,
  fetcher: typeof fetch = fetch,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("action", "preview");
  const res = await fetcher("/api/routerizador/workbook", {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data.preview?.token) {
    throw new Error(data.error || "Não foi possível validar a prévia.");
  }
  return data.preview as {
    token: string;
    filename: string;
    itemCount: number | null;
    orderCount: number;
    competence: string | null;
    warnings: string[];
  };
}

export async function confirmOperationalWorkbook(
  file: File,
  confirmationToken: string,
  fetcher: typeof fetch = fetch,
) {
  const form = new FormData();
  form.append("file", file);
  form.append("confirmation", confirmationToken);
  let res: Response;
  try {
    res = await fetcher("/api/routerizador/workbook", {
      method: "POST",
      body: form,
    });
  } catch {
    throw new Error(
      "Não foi possível confirmar o salvamento da carteira. Verifique a conexão e tente novamente.",
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data.error ||
        "A importação não foi confirmada. Confira a carteira salva e tente novamente.",
    );
  }
  if (
    typeof data.filename !== "string" ||
    !Array.isArray(data.rows) ||
    !data.importId ||
    !data.uploadedAt
  ) {
    throw new Error(
      "Resposta de importação inválida. Não foi possível confirmar a carteira ativa.",
    );
  }
  return {
    filename: data.filename as string,
    rows: data.rows as OrderRow[],
    uploadedAt: data.uploadedAt as string,
    importId: data.importId as string,
  };
}

export function onWorkbookConfirmed(
  callback: () => void,
  target: Window | undefined = typeof window !== "undefined" ? window : undefined,
) {
  if (!target) return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === WORKBOOK_CONFIRMED_EVENT) callback();
  };
  target.addEventListener(WORKBOOK_CONFIRMED_EVENT, callback);
  target.addEventListener("storage", onStorage);
  target.addEventListener("focus", callback);
  return () => {
    target.removeEventListener(WORKBOOK_CONFIRMED_EVENT, callback);
    target.removeEventListener("storage", onStorage);
    target.removeEventListener("focus", callback);
  };
}

export function StopDragHandle({
  index,
  name,
  disabled,
  onMove,
}: {
  index: number;
  name: string;
  disabled?: boolean;
  onMove: (fromIndex: number, toIndex: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{ pointer: number; target: number } | null>(null);

  const clearDrag = () => {
    document
      .querySelectorAll("[data-stop-drop]")
      .forEach((el) => el.removeAttribute("data-stop-drop"));
    dragStateRef.current = null;
    setDragging(false);
  };

  return (
    <button
      type="button"
      className="stop-drag-handle"
      disabled={disabled}
      aria-label={`Reorganizar ${name}. Arraste ou use as setas do teclado.`}
      aria-pressed={dragging}
      title="Arrastar para reorganizar"
      style={{
        touchAction: "none",
        cursor: dragging ? "grabbing" : "grab",
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          onMove(index, index + (e.key === "ArrowUp" ? -1 : 1));
        }
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStateRef.current = { pointer: e.pointerId, target: index };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (dragStateRef.current?.pointer !== e.pointerId) return;
        const container = e.currentTarget.closest(".builder-stops");
        if (!container) return;
        const items = Array.from(
          container.querySelectorAll<HTMLElement>("[data-stop-index]"),
        );
        const hovered = items.find((el) => {
          const rect = el.getBoundingClientRect();
          return e.clientY >= rect.top && e.clientY <= rect.bottom;
        });
        const targetIdx = Number(hovered?.dataset.stopIndex);
        if (Number.isInteger(targetIdx) && targetIdx > 0) {
          dragStateRef.current.target = targetIdx;
          items.forEach((el) => el.removeAttribute("data-stop-drop"));
          hovered?.setAttribute("data-stop-drop", "true");
        }
        let scrollEl: HTMLElement | null = container as HTMLElement;
        while (scrollEl && scrollEl.scrollHeight <= scrollEl.clientHeight) {
          scrollEl = scrollEl.parentElement;
        }
        if (scrollEl) {
          const rect = scrollEl.getBoundingClientRect();
          if (e.clientY < rect.top + 40) scrollEl.scrollTop -= 14;
          if (e.clientY > rect.bottom - 40) scrollEl.scrollTop += 14;
        }
      }}
      onPointerUp={(e) => {
        const state = dragStateRef.current;
        if (state?.pointer !== e.pointerId) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        const targetIdx = state.target;
        clearDrag();
        onMove(index, targetIdx);
      }}
      onPointerCancel={clearDrag}
      onLostPointerCapture={clearDrag}
    >
      <GripVertical size={18} aria-hidden="true" />
    </button>
  );
}

export function moveDeliveryStop<T>(
  stops: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 1 ||
    toIndex < 1 ||
    fromIndex >= stops.length ||
    toIndex >= stops.length ||
    fromIndex === toIndex
  ) {
    return stops;
  }
  const next = [...stops];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const VEHICLE_PRESETS: Record<
  string,
  { label: string; maxVol: number; maxWt: number; name: string; badge: string }
> = {
  tresquartos: {
    label: "3/4 — 40 m³",
    maxVol: 40,
    maxWt: 8000,
    name: "3/4",
    badge: "Leve",
  },
  toco: {
    label: "Toco — 50 m³",
    maxVol: 50,
    maxWt: 12000,
    name: "Toco",
    badge: "Médio",
  },
  truck: {
    label: "Truck — 70 m³",
    maxVol: 70,
    maxWt: 15000,
    name: "Truck",
    badge: "Pesado",
  },
  carreta: {
    label: "Carreta — 95 m³",
    maxVol: 95,
    maxWt: 27000,
    name: "Carreta",
    badge: "Pesado",
  },
  bitrem: {
    label: "Bitrem — 140 m³",
    maxVol: 140,
    maxWt: 40000,
    name: "Bitrem",
    badge: "Extra",
  },
  custom: {
    label: "Personalizado",
    maxVol: 90,
    maxWt: 20000,
    name: "Personalizado",
    badge: "Ajustável",
  },
};

const NE_STATES = [
  "AL",
  "AP",
  "BA",
  "CE",
  "MA",
  "PA",
  "PB",
  "PE",
  "PI",
  "RN",
  "SE",
  "TO",
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface Driver {
  id: string;
  name: string;
  phone?: string;
  active?: boolean;
}
interface Vehicle {
  id: string;
  name: string;
  plate: string;
  capacity_m3?: number;
  active?: boolean;
}
type FreightFilter = "Todos" | "CIF" | "FOB";

interface RouteViability {
  label: "Viável" | "Atenção" | "Inviável";
  color: string;
  bg: string;
  border: string;
  reasons: string[];
  score?: number;
}

export type ExtendedEngineConfig = EngineConfig & {
  minimumExceptions?: {
    confirmed: boolean;
    orderIds: string[];
  };
};

export type ExtendedEngineResult = EngineResult & {
  routingProof?: string;
};

// ─── Util ─────────────────────────────────────────────────────────────────────

async function api<T = unknown>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Erro ${res.status}`);
  return data as T;
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmt(n: number, dec = 2) {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function getFreightType(row: OrderRow): string {
  const raw =
    row.freightType ??
    row.extra?.["tipo frete"] ??
    row.extra?.["tipo_frete"] ??
    row.extra?.["frete"] ??
    "";
  return String(raw).trim().toUpperCase();
}

function getRowValue(row: OrderRow): number {
  if (
    typeof row.totalValue === "number" &&
    !isNaN(row.totalValue) &&
    row.totalValue > 0
  ) {
    return row.totalValue;
  }
  const raw =
    row.extra?.["total item"] ??
    row.extra?.["total_item"] ??
    row.extra?.["valor"] ??
    row.extra?.["vlr total"] ??
    row.extra?.["valor total"] ??
    "0";
  const s = String(raw).replace(/[^\d,.-]/g, "").replace(",", ".");
  return parseFloat(s) || 0;
}

function filterByFreight(rows: OrderRow[], filter: FreightFilter): OrderRow[] {
  if (filter === "Todos") return rows;
  return rows.filter((r) => {
    const ft = getFreightType(r);
    return ft === filter || ft.startsWith(filter);
  });
}

function estimateRouteHours(
  stops: number,
  distKm: number,
  speedKmh: number,
  serviceMin: number,
): string {
  const driveH = distKm / speedKmh;
  const serviceH = (stops * serviceMin) / 60;
  const total = driveH + serviceH;
  const h = Math.floor(total);
  const m = Math.round((total - h) * 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

function RoutePointMap({
  route,
  selectedStop,
}: {
  route: SuggestedRoute;
  selectedStop: SuggestedRoute["stops"][number] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!mounted || !containerRef.current) return;
      mapRef.current?.remove();
      const focus = selectedStop ?? route.stops[0];
      if (!focus || !Number.isFinite(focus.lat) || !Number.isFinite(focus.lng))
        return;
      if ((containerRef.current as any)._leaflet_id) {
        delete (containerRef.current as any)._leaflet_id;
      }
      const map = L.map(containerRef.current, { zoomControl: true }).setView(
        [focus.lat, focus.lng],
        10,
      );
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      const validStops = route.stops.filter(
        (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng),
      );
      if (validStops.length > 1) {
        const coords = validStops.map((s) => [s.lat, s.lng] as [number, number]);
        L.polyline(coords, {
          color: "#059669",
          weight: 4,
          opacity: 0.85,
          lineJoin: "round",
        }).addTo(map);
        if (!selectedStop) {
          map.fitBounds(L.latLngBounds(coords), { padding: [24, 24] });
        }
      }

      route.stops.forEach((stop) => {
        if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
        const active = stop.position === focus.position;
        L.circleMarker([stop.lat, stop.lng], {
          radius: active ? 12 : 7,
          color: active ? "#f59e0b" : "#38bdf8",
          fillColor: active ? "#f59e0b" : "#38bdf8",
          fillOpacity: 0.92,
          weight: 3,
        })
          .addTo(map)
          .bindPopup(
            `<strong>${stop.position}ª entrega · ${stop.city}</strong><br/>${stop.clientName || "Cliente"}`,
          );
      });
    })();
    return () => {
      mounted = false;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [route, selectedStop]);

  const missingCoordsCount = route.stops.filter(
    (s) => !Number.isFinite(s.lat) || !Number.isFinite(s.lng),
  ).length;

  return (
    <div>
      <div
        ref={containerRef}
        style={{
          height: 280,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--line)",
          marginBottom: 12,
        }}
      />
      {missingCoordsCount > 0 && (
        <div className="stop-coords-fallback">
          ⚠️ {missingCoordsCount}{" "}
          {missingCoordsCount === 1
            ? "parada sem coordenadas geográficas omitida da polilinha"
            : "paradas sem coordenadas geográficas omitidas da polilinha"}
          .
        </div>
      )}
    </div>
  );
}

function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcRouteKm(
  stops: SuggestedRoute["stops"],
  originLat: number,
  originLng: number,
): number {
  let total = 0;
  let prevLat = originLat;
  let prevLng = originLng;
  for (const s of stops) {
    if (s.lat && s.lng) {
      total += haversineKm(prevLat, prevLng, s.lat, s.lng);
      prevLat = s.lat;
      prevLng = s.lng;
    }
  }
  return Math.round(total);
}

function getRouteStates(r: SuggestedRoute): string {
  const ufs = new Set<string>();
  for (const s of r.stops) {
    for (const o of s.orders) {
      if (o.uf) ufs.add(o.uf.trim().toUpperCase());
    }
    const m = s.city.match(/\/([A-Z]{2})$/);
    if (m) ufs.add(m[1]);
  }
  return Array.from(ufs).join(" / ") || "—";
}

function getRouteValue(r: SuggestedRoute): number {
  let v = 0;
  for (const s of r.stops) {
    for (const o of s.orders) {
      v += getRowValue(o);
    }
  }
  return v;
}

function getRouteOrderIds(r: SuggestedRoute): string[] {
  const ids = new Set<string>();
  for (const s of r.stops) {
    for (const o of s.orders) {
      ids.add(o.orderId);
    }
  }
  return Array.from(ids);
}

function buildGoogleMapsUrl(r: SuggestedRoute, originName: string): string {
  const origin = encodeURIComponent(originName + ", Brasil");
  const stops = r.stops;
  if (!stops.length) return "#";
  const dest = encodeURIComponent(
    (stops[stops.length - 1]?.city ?? "") + ", Brasil",
  );
  const wps = stops
    .slice(0, -1)
    .map((s) => encodeURIComponent(s.city + ", Brasil"))
    .join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}${wps ? `&waypoints=${wps}` : ""}`;
}

function assessViability(
  r: SuggestedRoute,
  km: number,
  val: number,
  cost5: number,
  minVol: number,
): RouteViability {
  const reasons: string[] = [];
  let score = 100;

  if (r.occupancyPct < 30) {
    reasons.push(`Ocupação ${r.occupancyPct}% abaixo do mínimo`);
    score -= 50;
  } else if (r.occupancyPct > 98) {
    reasons.push(`Sobre-carregada (>98% capacidade)`);
    score -= 20;
  }

  if (r.totalVolumeM3 < minVol && minVol > 0) {
    reasons.push(
      `Volume ${fmt(r.totalVolumeM3)} m³ abaixo do mínimo dedicado ${minVol} m³`,
    );
    score -= 30;
  }

  if (val > 0) {
    const costPct = (((cost5 / 100) * val) / val) * 100;
    if (costPct > 15) {
      reasons.push(
        `Alerta financeiro: Custo do frete ${costPct.toFixed(1)}% sobre valor (>15% VFR)`,
      );
      score -= 50;
    } else if (costPct > 8) {
      reasons.push(`Custo do frete ${costPct.toFixed(1)}% sobre valor (>8%)`);
      score -= 40;
    } else if (costPct > 5) {
      reasons.push(`Custo do frete ${costPct.toFixed(1)}% sobre valor (5-8%)`);
      score -= 15;
    }
  }

  if (km > 3000) {
    reasons.push(
      `Distância ${km.toLocaleString("pt-BR")} km excessiva (>3000 km)`,
    );
    score -= 40;
  } else if (km > 1500) {
    reasons.push(`Distância ${km.toLocaleString("pt-BR")} km elevada`);
    score -= 10;
  }

  if (r.stops.length < 2) {
    reasons.push(`Apenas 1 parada (considere rota dedicada simples)`);
    score -= 15;
  }

  if (score >= 75) {
    return {
      label: "Viável",
      color: "#10b981",
      bg: "rgba(16,185,129,.12)",
      border: "rgba(16,185,129,.25)",
      reasons: reasons.length
        ? reasons
        : ["Rota dentro dos parâmetros configurados"],
      score,
    };
  }
  if (score >= 40) {
    return {
      label: "Atenção",
      color: "#f59e0b",
      bg: "rgba(245,158,11,.12)",
      border: "rgba(245,158,11,.25)",
      reasons,
      score,
    };
  }
  return {
    label: "Inviável",
    color: "#ef4444",
    bg: "rgba(239,68,68,.12)",
    border: "rgba(239,68,68,.25)",
    reasons,
    score,
  };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 14,
    padding: "16px 20px",
  } as React.CSSProperties,
  label: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--muted)",
    textTransform: "uppercase" as const,
    letterSpacing: ".08em",
    display: "block",
    marginBottom: 5,
  },
  input: {
    background: "var(--card-subtle)",
    color: "var(--ink)",
    border: "1px solid var(--line)",
    borderRadius: 9,
    padding: "9px 12px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  select: {
    background: "var(--card-subtle)",
    color: "var(--ink)",
    border: "1px solid var(--line)",
    borderRadius: 9,
    padding: "9px 12px",
    fontSize: 13,
    width: "100%",
    cursor: "pointer",
  },
  btnPrimary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 20px",
    borderRadius: 10,
    border: "none",
    background: "var(--green)",
    color: "#fff",
    fontWeight: 700,
    fontSize: 13,
    cursor: "pointer",
  } as React.CSSProperties,
  btnSecondary: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid var(--line)",
    background: "transparent",
    color: "var(--muted)",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  } as React.CSSProperties,
};

// ─── Occupancy Bar & Viability Popover ───────────────────────────────────────

function OccupancyBar({ pct }: { pct: number }) {
  const isOverloaded = pct > 100;
  const color =
    isOverloaded || pct >= 90
      ? "#ef4444"
      : pct >= 75
        ? "#f59e0b"
        : "#065f46";
  return (
    <div style={{ minWidth: 100 }}>
      <div
        className="occupancy-track"
        style={{
          height: 6,
          background: "var(--cubage-track, #e2e8f0)",
          borderRadius: 999,
          overflow: "hidden",
          marginBottom: 3,
        }}
      >
        <div
          className="occupancy-fill"
          style={{
            height: "100%",
            width: `${Math.min(Math.max(0, pct), 100)}%`,
            background: color,
            borderRadius: 999,
            transition: "width 0.2s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color }}>{pct}%</span>
        {isOverloaded && (
          <span
            style={{ fontSize: 10, color: "#ef4444", fontWeight: 800 }}
            title="Sobrecarga de veículo"
          >
            ⚠️ Sobrecarga
          </span>
        )}
      </div>
    </div>
  );
}

function ViabilityPopover({
  viability,
  onAdjustVehicle,
  onRemoveStops,
  onReviewMinOrder,
}: {
  viability: RouteViability;
  route: SuggestedRoute;
  onAdjustVehicle?: () => void;
  onRemoveStops?: () => void;
  onReviewMinOrder?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Esc") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  return (
    <div
      className="viability-popover-anchor"
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="viability-popover-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Status de viabilidade: ${viability.label}. Clique para ver diagnóstico e ações recomendadas.`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: viability.bg,
          color: viability.color,
          border: `1px solid ${viability.border}`,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        <span>
          {viability.label === "Viável"
            ? "✅"
            : viability.label === "Atenção"
              ? "⚠️"
              : "❌"}
        </span>
        <span>{viability.label}</span>
      </button>
      {open && (
        <>
          <div
            className="viability-popover-backdrop"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 999,
              background: "transparent",
            }}
          />
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="true"
            aria-label="Diagnóstico de Viabilidade e Recomendações"
            className="viability-popover"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                borderBottom: "1px solid var(--line)",
                paddingBottom: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>
                  {viability.label === "Viável"
                    ? "✅"
                    : viability.label === "Atenção"
                      ? "⚠️"
                      : "❌"}
                </span>
                <b style={{ fontSize: 13, color: "var(--ink)" }}>
                  Viabilidade: {viability.label}
                </b>
                {viability.score !== undefined && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      fontWeight: 600,
                    }}
                  >
                    ({viability.score}/100)
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar popover de viabilidade"
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: 2,
                }}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ marginBottom: 12 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Diagnóstico & Motivos
              </span>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 16,
                  color: "var(--ink)",
                  lineHeight: 1.5,
                }}
              >
                {viability.reasons.map((reason, idx) => (
                  <li key={idx} style={{ marginBottom: 3 }}>
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Ações Recomendadas
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  "Ajustar Veículo",
                  "Remover Paradas",
                  "Revisar Pedido Mínimo",
                ].map((action) => (
                  <button
                    key={action}
                    type="button"
                    className="viability-action-btn"
                    onClick={() => {
                      if (action === "Ajustar Veículo" && onAdjustVehicle) {
                        onAdjustVehicle();
                      } else if (action === "Remover Paradas" && onRemoveStops) {
                        onRemoveStops();
                      } else if (
                        action === "Revisar Pedido Mínimo" &&
                        onReviewMinOrder
                      ) {
                        onReviewMinOrder();
                      }
                      setOpen(false);
                    }}
                  >
                    <span>{action}</span>
                    <span style={{ color: "var(--muted)", fontSize: 11 }}>
                      →
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Step 1: Upload ───────────────────────────────────────────────────────────

function UploadStep({
  onParsed,
}: {
  onParsed: (rows: OrderRow[], filename: string) => void;
}) {
  const [pendingPreview, setPendingPreview] = useState<{
    file: File;
    preview: Awaited<ReturnType<typeof previewOperationalWorkbook>>;
  } | null>(null);
  const busyRef = useRef(false);
  const [importsHistory, setImportsHistory] = useState<
    Array<{
      id: string;
      filename: string;
      active?: boolean;
      uploaded_at?: string | null;
    }>
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [savedWorkbook, setSavedWorkbook] = useState<{
    filename: string;
    rows: OrderRow[];
    updatedAt?: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    let seq = 0;
    const load = () => {
      const currentSeq = ++seq;
      fetch("/api/routerizador/workbook", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (mounted && currentSeq === seq) {
            setSavedWorkbook(data?.workbook ?? null);
          }
        })
        .catch(() => {});
      fetch("/api/routerizador/workbook?history=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (mounted && currentSeq === seq) {
            setImportsHistory(data?.imports ?? []);
          }
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = onWorkbookConfirmed(load);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPendingPreview(null);
    setLoading(true);
    setErr("");
    try {
      const preview = await previewOperationalWorkbook(file);
      setPendingPreview({ file, preview });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  const confirmUpload = async () => {
    if (!pendingPreview || busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setErr("");
    try {
      const confirmed = await confirmOperationalWorkbook(
        pendingPreview.file,
        pendingPreview.preview.token,
      );
      setSavedWorkbook({ ...confirmed, updatedAt: confirmed.uploadedAt });
      window.dispatchEvent(new Event(WORKBOOK_CONFIRMED_EVENT));
      try {
        localStorage.setItem(WORKBOOK_CONFIRMED_EVENT, crypto.randomUUID());
      } catch {}
      onParsed(confirmed.rows, confirmed.filename);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div style={{ maxWidth: 560, margin: "60px auto" }}>
      {pendingPreview && (
        <section
          aria-label="Prévia da importação"
          style={{ ...S.card, marginBottom: 14 }}
        >
          <h3>Confirmar nova carteira</h3>
          <p>{pendingPreview.preview.filename}</p>
          <p>
            {pendingPreview.preview.itemCount ?? "Indeterminado"} itens ·{" "}
            {pendingPreview.preview.orderCount} pedidos
          </p>
          <p>
            Competência:{" "}
            {pendingPreview.preview.competence ??
              "não comprovada / pode conter vários períodos"}
          </p>
          <details>
            <summary>
              Inconsistências ({pendingPreview.preview.warnings.length})
            </summary>
            <ul>
              {pendingPreview.preview.warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </details>
          <p>
            A carteira atual ficará no histórico. Rotas existentes serão
            preservadas.
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={confirmUpload}
            style={S.btnPrimary}
          >
            Confirmar e ativar carteira
          </button>{" "}
          <button
            type="button"
            disabled={loading}
            onClick={() => setPendingPreview(null)}
          >
            Cancelar prévia
          </button>
        </section>
      )}
      {savedWorkbook && (
        <div
          style={{
            ...S.card,
            marginBottom: 14,
            borderColor: "rgba(16,185,129,.35)",
          }}
        >
          <strong style={{ color: "var(--green)" }}>
            Carteira atual salva
          </strong>
          <p style={{ margin: "6px 0", fontSize: 13 }}>
            {savedWorkbook.filename} · {savedWorkbook.rows.length} pedidos
          </p>
          <button
            type="button"
            onClick={() =>
              onParsed(savedWorkbook.rows, savedWorkbook.filename)
            }
            style={S.btnPrimary}
          >
            Usar carteira salva
          </button>
          <small
            style={{ display: "block", marginTop: 8, color: "var(--muted)" }}
          >
            Envie outra planilha abaixo para substituir esta carteira.
          </small>
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "var(--green)" : "var(--line)"}`,
          borderRadius: 18,
          padding: "52px 32px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "rgba(16,185,129,.06)" : "var(--card)",
          transition: "all .2s",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          disabled={loading}
          accept=".xlsx,.xls,.csv,.tsv,.not,.edi,.txt"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        {loading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              pointerEvents: "none",
            }}
          >
            <Loader2
              size={40}
              color="var(--green)"
              style={{ animation: "spin 1s linear infinite" }}
            />
            <p style={{ color: "var(--muted)", margin: 0, fontSize: 14 }}>
              Lendo planilha...
            </p>
          </div>
        ) : (
          <div style={{ pointerEvents: "none" }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "rgba(16,185,129,.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              <Upload size={28} color="var(--green)" />
            </div>
            <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: 16 }}>
              Importar Planilha Sabium
            </p>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Arraste ou clique · .xlsx, .xls, .csv
            </p>
          </div>
        )}
      </div>
      <details style={{ marginTop: 16 }}>
        <summary>Histórico de carteiras ({importsHistory.length})</summary>
        <ul>
          {importsHistory.map((item) => (
            <li key={item.id}>
              {item.filename} · {item.active ? "Ativa" : "Histórico"} ·{" "}
              {item.uploaded_at
                ? new Date(item.uploaded_at).toLocaleString("pt-BR")
                : "Upload original não comprovado"}{" "}
              ·{" "}
              <a
                style={{ color: "var(--green)" }}
                href={`/api/routerizador/workbook?download=${item.id}`}
              >
                Baixar arquivo
              </a>
            </li>
          ))}
        </ul>
      </details>
      {err && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.25)",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <AlertTriangle
            size={16}
            color="#ef4444"
            style={{ flexShrink: 0, marginTop: 1 }}
          />
          <p style={{ margin: 0, color: "#ef4444", fontSize: 13 }}>{err}</p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Config & Generate ────────────────────────────────────────────────

function ConfigStep({
  rows,
  filename,
  onBack,
  onGenerate,
}: {
  rows: OrderRow[];
  filename: string;
  onBack: () => void;
  onGenerate: (
    result: ExtendedEngineResult,
    config: ExtendedEngineConfig,
    vehiclePreset: string,
    serviceMin: number,
    speedKmh: number,
    costPctMin: number,
    costPctMax: number,
    minVolDed: number,
    freightFilter: FreightFilter,
  ) => void;
}) {
  const [freightFilter, setFreightFilter] = useState<FreightFilter>("Todos");
  const [vehicle, setVehicle] = useState("carreta");
  const [maxVol, setMaxVol] = useState(95);
  const [maxWt, setMaxWt] = useState(27000);
  const [selectedStates, setSelectedStates] = useState<Set<string>>(
    new Set(["Todos"]),
  );
  const [prioritizeAging, setPrioritizeAging] = useState(true);
  const [autoGeocode, setAutoGeocode] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const [configOpen, setConfigOpen] = useState(true);
  const [selectedBelowMinIds, setSelectedBelowMinIds] = useState<Set<string>>(
    new Set(),
  );
  const [confirmedBelowMin, setConfirmedBelowMin] = useState(false);
  const [showMinValueModal, setShowMinValueModal] = useState(false);

  const selectVehicle = (k: string) => {
    setVehicle(k);
    if (k !== "custom") {
      const p = VEHICLE_PRESETS[k];
      setMaxVol(p.maxVol);
      setMaxWt(p.maxWt);
    }
  };

  const toggleState = (uf: string) => {
    setSelectedStates((prev) => {
      const next = new Set(prev);
      if (uf === "Todos") return new Set(["Todos"]);
      next.delete("Todos");
      if (next.has(uf)) next.delete(uf);
      else next.add(uf);
      if (next.size === 0) return new Set(["Todos"]);
      return next;
    });
  };

  const filtered = filterByFreight(rows, freightFilter);
  const stateFiltered = selectedStates.has("Todos")
    ? filtered
    : filtered.filter((r) =>
        selectedStates.has((r.uf ?? "").trim().toUpperCase()),
      );

  const cifCount = rows.filter((r) => getFreightType(r) === "CIF").length;
  const fobCount = rows.filter((r) => getFreightType(r) === "FOB").length;
  const totalCities = new Set(filtered.map((r) => r.city)).size;
  const totalVol = filtered.reduce((s, r) => s + r.volumeM3, 0);

  const belowMinOrders = useMemo(() => {
    return stateFiltered.filter(
      (r) => !checkOrderMinEligibility(r).eligible && getFreightType(r) === "CIF",
    );
  }, [stateFiltered]);

  const handleGenerate = async () => {
    setGenerating(true);
    setErr("");
    try {
      const rowsByState = selectedStates.has("Todos")
        ? filtered
        : filtered.filter((r) =>
            selectedStates.has((r.uf ?? "").trim().toUpperCase()),
          );

      const hasExplicitFreight = rowsByState.some((r) => !!getFreightType(r));
      const rowsToRoute = hasExplicitFreight
        ? rowsByState.filter((r) => getFreightType(r) === "CIF")
        : rowsByState;

      if (rowsToRoute.length === 0) {
        throw new Error(
          "Não há pedidos CIF nos estados selecionados para roteirizar com a frota própria.",
        );
      }

      const today = new Date().toISOString().slice(0, 10);
      const minimumExceptions = {
        confirmed: confirmedBelowMin,
        orderIds: [...selectedBelowMinIds].filter((id) =>
          rowsToRoute.some((r) => r.orderId === id),
        ),
      };

      if (minimumExceptions.orderIds.length && !confirmedBelowMin) {
        throw new Error(
          "Confirme a inclusão dos pedidos selecionados abaixo do mínimo.",
        );
      }

      const config: ExtendedEngineConfig = {
        maxVolumeM3: maxVol,
        maxWeightKg: maxWt,
        clusterRadiusKm: 80,
        routeDate: today,
        originName: "Campina Grande/PB",
        originLat: -7.2306,
        originLng: -35.8811,
        minVolumeM3: 20,
        prioritizeAging,
        returnToOrigin: false,
        averageSpeed: 52,
        serviceMinutes: 40,
        maxHours: 84,
        enforceMinOrderValue: true,
        minimumExceptions,
      };

      const result = await api<ExtendedEngineResult>(
        "/api/routerizador/generate",
        {
          method: "POST",
          body: JSON.stringify({
            rows: rowsToRoute,
            config,
            minimumException: minimumExceptions,
          }),
        },
      );
      onGenerate(result, config, vehicle, 40, 52, 3, 5, 20, freightFilter);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div>
      {/* Top summary bar */}
      <div
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <button onClick={onBack} style={S.btnSecondary}>
          <ArrowLeft size={15} /> Voltar
        </button>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          📄 <strong style={{ color: "var(--ink)" }}>{filename}</strong> —{" "}
          <strong>{rows.length}</strong> pedidos ·{" "}
          <strong>{new Set(rows.map((r) => r.city)).size}</strong> cidades ·
          <strong style={{ color: "#10b981" }}> CIF: {cifCount}</strong> ·{" "}
          <strong style={{ color: "#f59e0b" }}> FOB: {fobCount}</strong>
        </span>
      </div>

      {/* Freight type filter */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 13 }}>
          🚛 Filtro de Tipo de Frete
        </p>
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {(["Todos", "CIF", "FOB"] as FreightFilter[]).map((f) => {
            const active = freightFilter === f;
            const col =
              f === "CIF" ? "#10b981" : f === "FOB" ? "#f59e0b" : "var(--green)";
            return (
              <button
                key={f}
                onClick={() => setFreightFilter(f)}
                style={{
                  padding: "7px 18px",
                  borderRadius: 8,
                  border: `1px solid ${active ? col : "var(--line)"}`,
                  background: active ? `${col}22` : "transparent",
                  color: active ? col : "var(--muted)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {f === "Todos"
                  ? `Todos (${rows.length})`
                  : f === "CIF"
                    ? `CIF (${cifCount})`
                    : `FOB (${fobCount})`}
              </button>
            );
          })}
          <span
            style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}
          >
            {filtered.length} pedidos · {totalCities} cidades · {fmt(totalVol)}{" "}
            m³
          </span>
        </div>
      </div>

      {/* Minimum Order Value Rules Card */}
      <div
        style={{
          ...S.card,
          marginBottom: 14,
          borderLeft: "4px solid #f59e0b",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 4px",
                fontWeight: 700,
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              📋 Mínimo por pedido, conforme a UF · modo padrão
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
              PB: <strong style={{ color: "var(--ink)" }}>R$ 1.500</strong> ·
              AL, BA, CE, PE, RN, SE:{" "}
              <strong style={{ color: "var(--ink)" }}>R$ 2.000</strong> · MA,
              PA, PI, TO:{" "}
              <strong style={{ color: "var(--ink)" }}>R$ 7.000</strong> · AP:{" "}
              <strong style={{ color: "var(--ink)" }}>R$ 10.000</strong>
            </p>
            {selectedBelowMinIds.size > 0 && (
              <p style={{ fontSize: 12, margin: "6px 0 0" }}>
                Modo flexível: {selectedBelowMinIds.size} pedidos selecionados ·{" "}
                {confirmedBelowMin ? "confirmados" : "confirmação pendente"}. Os
                demais mantêm o mínimo.
              </p>
            )}
          </div>
          {belowMinOrders.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700 }}
              >
                ⚠ {belowMinOrders.length}{" "}
                {belowMinOrders.length === 1
                  ? "pedido abaixo"
                  : "pedidos abaixo"}{" "}
                do mínimo
              </span>
              <button
                type="button"
                onClick={() => setShowMinValueModal(true)}
                style={{
                  ...S.btnSecondary,
                  padding: "5px 12px",
                  fontSize: 11,
                  background: "rgba(245,158,11,.1)",
                  borderColor: "rgba(245,158,11,.3)",
                  color: "#f59e0b",
                }}
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

      {/* Collapsible vehicle + state config */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <button
          onClick={() => setConfigOpen((o) => !o)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--ink)",
            fontWeight: 700,
            fontSize: 13,
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
          }}
        >
          <span style={{ opacity: 0.5, fontSize: 10 }}>
            {configOpen ? "▼" : "▶"}
          </span>
          Configuração do veículo e cálculo
        </button>

        {configOpen && (
          <div style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={S.label}>Veículo da Frota</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  Capacidade: <strong>{maxVol} m³</strong> ·{" "}
                  <strong>{maxWt.toLocaleString("pt-BR")} kg</strong>
                </span>
              </div>
              <div className="vehicle-cards-grid">
                {Object.entries(VEHICLE_PRESETS).map(([k, v]) => {
                  const active = vehicle === k;
                  return (
                    <div
                      key={k}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      aria-label={`${v.name || v.label}: capacidade de ${v.maxVol} m³ e ${v.maxWt} kg`}
                      className={`vehicle-card ${active ? "active" : ""}`}
                      onClick={() => selectVehicle(k)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          selectVehicle(k);
                        }
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Truck
                            size={16}
                            color={active ? "var(--green)" : "var(--muted)"}
                          />
                          <strong
                            style={{
                              fontSize: 13,
                              color: active ? "var(--green)" : "var(--ink)",
                            }}
                          >
                            {v.name || v.label.split(" — ")[0]}
                          </strong>
                        </div>
                        {active ? (
                          <CheckCircle2
                            size={15}
                            color="var(--green)"
                            style={{ flexShrink: 0 }}
                          />
                        ) : v.badge ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "var(--card)",
                              border: "1px solid var(--line)",
                              color: "var(--muted)",
                            }}
                          >
                            {v.badge}
                          </span>
                        ) : null}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: 11,
                          color: "var(--muted)",
                          borderTop: `1px solid ${active ? "var(--green-border)" : "var(--line)"}`,
                          paddingTop: 6,
                        }}
                      >
                        <span>
                          📦 <strong>{v.maxVol} m³</strong>
                        </span>
                        <span>
                          ⚖️ <strong>{v.maxWt.toLocaleString("pt-BR")} kg</strong>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {vehicle === "custom" && (
                <div
                  style={{
                    marginTop: 10,
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    padding: "10px 12px",
                    background: "var(--card-subtle)",
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                  }}
                >
                  <label>
                    <span style={S.label}>
                      Capacidade Volumétrica Personalizada (m³)
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={maxVol}
                      onChange={(e) =>
                        setMaxVol(
                          Math.max(1, Math.min(200, Number(e.target.value) || 0)),
                        )
                      }
                      style={S.input}
                    />
                  </label>
                  <label>
                    <span style={S.label}>
                      Capacidade de Peso Personalizada (kg)
                    </span>
                    <input
                      type="number"
                      min={100}
                      max={60000}
                      value={maxWt}
                      onChange={(e) =>
                        setMaxWt(
                          Math.max(
                            100,
                            Math.min(60000, Number(e.target.value) || 0),
                          ),
                        )
                      }
                      style={S.input}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* State checkboxes */}
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <span style={S.label}>Estados incluídos no cálculo</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  {selectedStates.has("Todos")
                    ? "Todos os estados"
                    : Array.from(selectedStates).join(", ")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Todos", ...NE_STATES].map((uf) => {
                  const checked =
                    selectedStates.has(uf) ||
                    (uf !== "Todos" && selectedStates.has("Todos"));
                  const isTodos = uf === "Todos";
                  return (
                    <label
                      key={uf}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "5px 10px",
                        borderRadius: 7,
                        border: `1px solid ${checked ? "rgba(16,185,129,.4)" : "var(--line)"}`,
                        background: checked
                          ? "rgba(16,185,129,.08)"
                          : "transparent",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: isTodos ? 700 : 600,
                        color: checked ? "var(--ink)" : "var(--muted)",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleState(uf)}
                        style={{ accentColor: "var(--green)" }}
                      />
                      {uf}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Options */}
            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                marginBottom: 14,
              }}
            >
              {[
                {
                  label: "Priorizar registros mais antigos",
                  val: prioritizeAging,
                  set: setPrioritizeAging,
                },
                {
                  label: "Buscar coordenadas online quando não cadastrada",
                  val: autoGeocode,
                  set: setAutoGeocode,
                },
              ].map(({ label, val, set }) => (
                <label
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={val}
                    onChange={(e) => set(e.target.checked)}
                    style={{ accentColor: "var(--green)" }}
                  />
                  {label}
                </label>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                style={{
                  ...S.btnPrimary,
                  opacity: generating || !filtered.length ? 0.65 : 1,
                }}
                onClick={handleGenerate}
                disabled={generating || !filtered.length}
              >
                {generating ? (
                  <Loader2
                    size={15}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                ) : (
                  <RefreshCw size={15} />
                )}
                {generating ? "Gerando rotas..." : "Aplicar configuração"}
              </button>
              <button
                style={S.btnSecondary}
                onClick={() => {
                  selectVehicle("carreta");
                  setSelectedStates(new Set(["Todos"]));
                  setPrioritizeAging(true);
                  setAutoGeocode(true);
                  setSelectedBelowMinIds(new Set());
                  setConfirmedBelowMin(false);
                }}
              >
                <RotateCcw size={14} /> Restaurar padrão
              </button>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {filtered.length === 0
                  ? "⚠ Nenhum pedido após filtro"
                  : `Configuração aplicada. ${filtered.length} pedidos disponíveis.`}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Below Minimum Orders Modal */}
      {showMinValueModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.6)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Exceção ao mínimo por UF"
            style={{
              background: "var(--card)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              maxWidth: 720,
              width: "100%",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 40px rgba(0,0,0,.4)",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                  Pedidos Abaixo do Pedido Mínimo Estadual
                </h3>
                <small style={{ color: "var(--muted)" }}>
                  {belowMinOrders.length} pedidos inicialmente excluídos. Cada
                  pedido consolidado é avaliado pelo mínimo da sua UF, sem somar
                  pedidos diferentes.
                </small>
              </div>
              <button
                type="button"
                onClick={() => setShowMinValueModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted)",
                }}
              >
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--line)",
                      textAlign: "left",
                      color: "var(--muted)",
                    }}
                  >
                    <th>Incluir</th>
                    <th style={{ padding: "6px 8px" }}>Pedido</th>
                    <th style={{ padding: "6px 8px" }}>Cliente</th>
                    <th style={{ padding: "6px 8px" }}>Cidade/UF</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>
                      Valor Atual
                    </th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>
                      Mínimo
                    </th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>
                      Faltante
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {belowMinOrders.map((o) => {
                    const check = checkOrderMinEligibility(o);
                    return (
                      <tr
                        key={o.orderId}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,.05)",
                        }}
                      >
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Incluir pedido ${o.orderId} abaixo do mínimo`}
                            checked={selectedBelowMinIds.has(o.orderId)}
                            onChange={(e) => {
                              setSelectedBelowMinIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(o.orderId);
                                else next.delete(o.orderId);
                                return next;
                              });
                              setConfirmedBelowMin(false);
                            }}
                          />
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            fontWeight: 700,
                            color: "#38bdf8",
                          }}
                        >
                          {o.orderId}
                        </td>
                        <td style={{ padding: "8px" }}>{o.client}</td>
                        <td style={{ padding: "8px" }}>
                          {o.city} {o.uf ? `(${o.uf})` : ""}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: "#f59e0b",
                            fontWeight: 700,
                          }}
                        >
                          {fmtBRL(check.currentValue)}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: "var(--muted)",
                          }}
                        >
                          {fmtBRL(check.minRequired)}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: "#ef4444",
                            fontWeight: 700,
                          }}
                        >
                          -{fmtBRL(check.difference)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--line)",
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              <p style={{ width: "100%", fontSize: 12 }}>
                Selecionados:{" "}
                {
                  belowMinOrders.filter((o) =>
                    selectedBelowMinIds.has(o.orderId),
                  ).length
                }{" "}
                pedidos ·{" "}
                {fmtBRL(
                  belowMinOrders
                    .filter((o) => selectedBelowMinIds.has(o.orderId))
                    .reduce((acc, o) => acc + (o.totalValue ?? 0), 0),
                )}
                . Estoque, mapa, capacidade e permissões continuam obrigatórios.
              </p>
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={confirmedBelowMin}
                  onChange={(e) => setConfirmedBelowMin(e.target.checked)}
                />{" "}
                Confirmo a inclusão dos pedidos selecionados mesmo abaixo do
                mínimo.
              </label>
              <button
                type="button"
                disabled={
                  !confirmedBelowMin ||
                  !belowMinOrders.some((o) =>
                    selectedBelowMinIds.has(o.orderId),
                  )
                }
                onClick={() => setShowMinValueModal(false)}
                style={S.btnPrimary}
              >
                Incluir selecionados abaixo do mínimo
              </button>
              <button
                type="button"
                onClick={() => setShowMinValueModal(false)}
                style={S.btnPrimary}
              >
                Entendido / Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {err && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.25)",
            color: "#ef4444",
            fontSize: 13,
            marginTop: 8,
          }}
        >
          ⚠ {err}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Results Table + Dispatch ─────────────────────────────────────────

function ResultsTable({
  result,
  filename,
  engineConfig,
  vehiclePreset,
  serviceMin,
  speedKmh,
  costPctMin,
  costPctMax,
  minVolDed,
  freightFilter,
  onBack,
  onDispatched,
  onOpenInPlanner,
}: {
  result: ExtendedEngineResult;
  filename: string;
  engineConfig: ExtendedEngineConfig;
  vehiclePreset: string;
  serviceMin: number;
  speedKmh: number;
  costPctMin: number;
  costPctMax: number;
  minVolDed: number;
  freightFilter: FreightFilter;
  onBack: () => void;
  onDispatched: (ids: string[]) => void;
  onOpenInPlanner?: (
    route: SuggestedRoute,
    config: ExtendedEngineConfig,
    routingProof?: string,
  ) => void;
}) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [assignments, setAssignments] = useState<
    Record<number, { driverId: string; vehicleId: string }>
  >({});
  const [detailRoute, setDetailRoute] = useState<SuggestedRoute | null>(null);
  const [selectedDetailStop, setSelectedDetailStop] = useState<
    SuggestedRoute["stops"][number] | null
  >(null);
  const [dispatching, setDispatching] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      api<Driver[]>("/api/drivers").catch(() => [] as Driver[]),
      api<Vehicle[]>("/api/vehicles").catch(() => [] as Vehicle[]),
    ]).then(([d, v]) => {
      setDrivers(d.filter((x) => x.active !== false));
      setVehicles(v.filter((x) => x.active !== false));
    });
  }, []);

  const setAssign = (
    idx: number,
    key: "driverId" | "vehicleId",
    val: string,
  ) => {
    setAssignments((prev) => ({
      ...prev,
      [idx]: { ...prev[idx], [key]: val },
    }));
  };

  const handleDispatch = async () => {
    setDispatching(true);
    setErr("");
    try {
      const payload = result.routes.map((r) => ({
        suggested: r,
        driverId: assignments[r.index]?.driverId ?? "",
        vehicleId: assignments[r.index]?.vehicleId ?? "",
      }));
      const res = await api<{ routeIds: string[] }>(
        "/api/routerizador/dispatch",
        {
          method: "POST",
          body: JSON.stringify({
            routes: payload,
            routeDate: engineConfig.routeDate,
            importFilename: filename,
            routingProof: result.routingProof,
          }),
        },
      );
      onDispatched(res.routeIds);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDispatching(false);
    }
  };

  const assignedCount = result.routes.filter(
    (r) => assignments[r.index]?.driverId,
  ).length;
  const totalVal = result.routes.reduce((s, r) => s + getRouteValue(r), 0);
  const vPresetLabel = VEHICLE_PRESETS[vehiclePreset]?.label ?? vehiclePreset;

  const TH = ({
    children,
    minW,
  }: {
    children: React.ReactNode;
    minW?: number;
  }) => (
    <th
      style={{
        padding: "9px 10px",
        fontSize: 10,
        fontWeight: 700,
        color: "var(--muted)",
        textTransform: "uppercase",
        letterSpacing: ".07em",
        whiteSpace: "nowrap",
        borderBottom: "1px solid var(--line)",
        background: "var(--card-subtle)",
        position: "sticky",
        top: 0,
        zIndex: 2,
        minWidth: minW,
        textAlign: "left",
      }}
    >
      {children}
    </th>
  );

  return (
    <div>
      {!!engineConfig.minimumExceptions?.orderIds.length && (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          A autorização acompanha esta rota no planejador. Alterar a ordem exige
          confirmação; novos pedidos ou destinos exigem nova geração autorizada.
        </p>
      )}

      {/* Summary strip */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <button onClick={onBack} style={S.btnSecondary}>
          <ArrowLeft size={14} /> Reconfigurar
        </button>
        {[
          { l: "Rotas", v: result.stats.totalRoutes },
          { l: "Pedidos", v: result.stats.totalOrders },
          { l: "Volume", v: `${fmt(result.stats.totalVolumeM3)} m³` },
          { l: "Ocupação média", v: `${result.stats.avgOccupancyPct}%` },
          { l: "Valor total", v: fmtBRL(totalVal) },
          { l: "Veículo", v: vPresetLabel },
          { l: "Frete", v: freightFilter },
        ].map(({ l, v }) => (
          <div
            key={l}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              background: "var(--card)",
              border: "1px solid var(--line)",
              fontSize: 12,
            }}
          >
            <span style={{ color: "var(--muted)" }}>{l}: </span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>

      {/* Unassigned breakdown */}
      {result.unassigned.length > 0 &&
        (() => {
          const minValHeld = result.unassigned.filter((u) =>
            u.extra?.unassignedReason?.includes("mínimo"),
          );
          const geoOrCapHeld = result.unassigned.filter(
            (u) => !u.extra?.unassignedReason?.includes("mínimo"),
          );
          return (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                marginBottom: 14,
              }}
            >
              {minValHeld.length > 0 && (
                <div
                  style={{
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "rgba(245,158,11,.08)",
                    border: "1px dashed rgba(245,158,11,.4)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "#f59e0b", fontWeight: 700 }}>
                    📋 {minValHeld.length}{" "}
                    {minValHeld.length === 1
                      ? "pedido retido"
                      : "pedidos retidos"}{" "}
                    por valor abaixo do mínimo estadual
                  </span>
                  <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                    — PB: R$ 1.500 · AL/BA/CE/PE/RN/SE: R$ 2.000 · MA/PA/PI/TO:
                    R$ 7.000 · AP: R$ 10.000
                  </span>
                </div>
              )}
              {geoOrCapHeld.length > 0 && (
                <div
                  style={{
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "rgba(239,68,68,.07)",
                    border: "1px dashed rgba(239,68,68,.3)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ color: "#ef4444", fontWeight: 700 }}>
                    ⚠ {geoOrCapHeld.length}{" "}
                    {geoOrCapHeld.length === 1
                      ? "pedido não roteirizado"
                      : "pedidos não roteirizados"}
                  </span>
                  <span style={{ color: "var(--muted)", marginLeft: 6 }}>
                    — cidade sem coordenada confirmada no mapa ou capacidade
                    excedida.
                  </span>
                </div>
              )}
            </div>
          );
        })()}

      {/* Main table */}
      <div
        style={{
          borderRadius: 14,
          overflow: "auto",
          border: "1px solid var(--line)",
          marginBottom: 16,
          maxHeight: "62vh",
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            background: "var(--card)",
            color: "var(--ink)",
            fontSize: 12,
          }}
        >
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
            {result.routes.map((r) => {
              const ufs = getRouteStates(r);
              const orderIds = getRouteOrderIds(r);
              const val = getRouteValue(r);
              const km = calcRouteKm(
                r.stops,
                engineConfig.originLat,
                engineConfig.originLng,
              );
              const hours = estimateRouteHours(
                r.stops.length,
                km,
                speedKmh,
                serviceMin,
              );
              const cost3 = (costPctMin / 100) * val;
              const cost5 = (costPctMax / 100) * val;
              const viab = assessViability(r, km, val, cost5, minVolDed);
              const assign = assignments[r.index] ?? {
                driverId: "",
                vehicleId: "",
              };
              const isSelected = detailRoute?.index === r.index;

              return (
                <tr
                  key={r.index}
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,.05)",
                    background: isSelected
                      ? "rgba(56,189,248,.05)"
                      : "transparent",
                    cursor: "default",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background =
                        "rgba(255,255,255,.02)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Rota */}
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <button
                      onClick={() => {
                        setDetailRoute(isSelected ? null : r);
                        setSelectedDetailStop(
                          isSelected ? null : (r.stops[0] ?? null),
                        );
                      }}
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#38bdf8",
                        fontWeight: 700,
                        fontSize: 12,
                        padding: 0,
                        textDecoration: "underline",
                      }}
                    >
                      Dedicada {r.index}
                    </button>
                  </td>

                  {/* Ações */}
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                      }}
                    >
                      <a
                        href={buildGoogleMapsUrl(r, engineConfig.originName)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "4px 10px",
                          borderRadius: 6,
                          background: "rgba(16,185,129,.18)",
                          color: "#10b981",
                          border: "1px solid rgba(16,185,129,.3)",
                          fontSize: 11,
                          fontWeight: 700,
                          textDecoration: "none",
                        }}
                      >
                        <ExternalLink size={11} /> Google Maps
                      </a>
                      {onOpenInPlanner &&
                        (!engineConfig.minimumExceptions?.orderIds.length ||
                          result.routingProof) && (
                          <button
                            onClick={() =>
                              onOpenInPlanner(
                                r,
                                engineConfig,
                                result.routingProof,
                              )
                            }
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              padding: "4px 10px",
                              borderRadius: 6,
                              background: "rgba(56,189,248,.12)",
                              color: "#38bdf8",
                              border: "1px solid rgba(56,189,248,.25)",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            <MapPin size={11} /> Detalhes/mapa
                          </button>
                        )}
                    </div>
                  </td>

                  {/* Atribuição inline */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      minWidth: 200,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 5,
                      }}
                    >
                      <select
                        value={assign.driverId ?? ""}
                        onChange={(e) =>
                          setAssign(r.index, "driverId", e.target.value)
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
                        aria-label={`Motorista da Dedicada ${r.index}`}
                      >
                        <option value="">— Motorista —</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={assign.vehicleId ?? ""}
                        onChange={(e) =>
                          setAssign(r.index, "vehicleId", e.target.value)
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
                        aria-label={`Veículo da Dedicada ${r.index}`}
                      >
                        <option value="">— Veículo —</option>
                        {vehicles.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.plate}
                          </option>
                        ))}
                      </select>
                      {assign.driverId && assign.vehicleId ? (
                        <span
                          style={{
                            fontSize: 10,
                            color: "#10b981",
                            fontWeight: 700,
                          }}
                        >
                          ✓ Atribuído
                        </span>
                      ) : assign.driverId ? (
                        <span style={{ fontSize: 10, color: "#f59e0b" }}>
                          Falta vincular veículo
                        </span>
                      ) : null}
                    </div>
                  </td>

                  {/* Região/Eixo */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      color: "rgba(255,255,255,.5)",
                      fontSize: 11,
                    }}
                  >
                    {ufs}
                  </td>

                  {/* Sequência sugerida */}
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <div
                      className="stop-sequence timeline"
                      style={{ fontSize: 11 }}
                    >
                      <div
                        style={{
                          color: "var(--muted)",
                          fontSize: 10,
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "#10b981",
                            display: "inline-block",
                          }}
                        />
                        <span>{engineConfig.originName} (Origem)</span>
                      </div>
                      {r.stops.map((s, i) => (
                        <div
                          key={i}
                          style={{
                            fontWeight: 700,
                            paddingLeft: 8,
                            borderLeft: "2px solid var(--line)",
                            marginLeft: 2,
                            marginTop: 2,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <span style={{ fontSize: 10, color: "var(--muted)" }}>
                            {i + 1}ª
                          </span>
                          <span>
                            {s.city.replace(/, [A-Z]{2}$/, "").toUpperCase()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>

                  {/* Entregas */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {r.stops.length}
                  </td>

                  {/* Pedidos */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {r.totalOrders}
                  </td>

                  {/* M³ */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      textAlign: "right",
                      fontWeight: 600,
                    }}
                  >
                    {fmt(r.totalVolumeM3)}
                  </td>

                  {/* Ocupação */}
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <OccupancyBar pct={r.occupancyPct} />
                  </td>

                  {/* Valor */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {val > 0 ? (
                      fmtBRL(val)
                    ) : (
                      <span style={{ color: "rgba(255,255,255,.2)" }}>—</span>
                    )}
                  </td>

                  {/* Custo base */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontSize: 11,
                      color: "rgba(255,255,255,.3)",
                    }}
                  >
                    <div>—</div>
                    <div style={{ fontSize: 10 }}>Carteira</div>
                    <div style={{ fontSize: 10 }}>Estimativa local</div>
                  </td>

                  {/* KM planejado */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontSize: 11,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>
                      {km > 0 ? `${km.toLocaleString("pt-BR")} km` : "—"}
                    </div>
                    <div style={{ color: "rgba(255,255,255,.3)", fontSize: 10 }}>
                      Estimativa local
                    </div>
                  </td>

                  {/* Tempo oper. */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontWeight: 700,
                    }}
                  >
                    {hours}
                  </td>

                  {/* Custo min% */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontSize: 11,
                    }}
                  >
                    {val > 0 ? (
                      <>
                        <div style={{ fontWeight: 700 }}>{fmtBRL(cost3)}</div>
                        <div
                          style={{ color: "rgba(255,255,255,.3)", fontSize: 10 }}
                        >
                          {costPctMin}% do valor
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Custo max% */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontSize: 11,
                    }}
                  >
                    {val > 0 ? (
                      <>
                        <div style={{ fontWeight: 700 }}>{fmtBRL(cost5)}</div>
                        <div
                          style={{ color: "rgba(255,255,255,.3)", fontSize: 10 }}
                        >
                          {costPctMax}% do valor
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>

                  {/* Nº Pedidos */}
                  <td
                    style={{
                      padding: "10px 10px",
                      verticalAlign: "top",
                      fontSize: 10,
                      color: "rgba(255,255,255,.55)",
                      lineHeight: 1.7,
                    }}
                  >
                    {orderIds.slice(0, 10).map((id) => (
                      <div key={id}>{id}</div>
                    ))}
                    {orderIds.length > 10 && (
                      <div style={{ color: "rgba(255,255,255,.3)" }}>
                        +{orderIds.length - 10} mais
                      </div>
                    )}
                  </td>

                  {/* Viabilidade */}
                  <td style={{ padding: "10px 10px", verticalAlign: "top" }}>
                    <ViabilityPopover
                      viability={viab}
                      route={r}
                      onAdjustVehicle={onBack}
                      onRemoveStops={() => {
                        setDetailRoute(r);
                        setSelectedDetailStop(r.stops[0] ?? null);
                      }}
                      onReviewMinOrder={onBack}
                    />
                    {assign.driverId && (
                      <div
                        style={{ marginTop: 4, fontSize: 10, color: "#10b981" }}
                      >
                        ✓ Atribuído
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expandable route detail panel */}
      {detailRoute && (
        <div
          style={{
            marginBottom: 16,
            padding: "16px 20px",
            borderRadius: 14,
            border: "1px solid var(--line)",
            background: "var(--card)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "rgba(16,185,129,.15)",
                  color: "#10b981",
                  fontWeight: 900,
                  fontSize: 14,
                }}
              >
                {detailRoute.index}
              </span>
              <div>
                <p
                  style={{
                    margin: 0,
                    fontWeight: 700,
                    color: "var(--ink)",
                    fontSize: 14,
                  }}
                >
                  {detailRoute.name}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
                  {detailRoute.totalOrders} pedidos · {detailRoute.stops.length}{" "}
                  paradas · {fmt(detailRoute.totalVolumeM3)} m³
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {onOpenInPlanner &&
                (!engineConfig.minimumExceptions?.orderIds.length ||
                  result.routingProof) && (
                  <button
                    onClick={() =>
                      onOpenInPlanner(
                        detailRoute,
                        engineConfig,
                        result.routingProof,
                      )
                    }
                    style={{ ...S.btnPrimary, fontSize: 12, padding: "7px 14px" }}
                  >
                    <MapPin size={13} /> Abrir e Revisar no Mapa
                  </button>
                )}
              <button
                onClick={() => setDetailRoute(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--muted)",
                  padding: 4,
                }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <p
            style={{
              margin: "0 0 8px",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".1em",
            }}
          >
            📦 Sequência de Paradas & Ordem de Carregamento (LIFO)
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
            Clique em uma cidade para localizá-la no mapa ou use a alça para
            reordenar entregas.
          </p>
          <RoutePointMap route={detailRoute} selectedStop={selectedDetailStop} />
          <div
            className="builder-stops stop-sequence timeline"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              marginBottom: 16,
            }}
          >
            <div
              className="timeline-item origin-depot"
              data-stop-index={0}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 9,
                background: "var(--card-subtle)",
                border: "1px dashed #10b981",
                color: "var(--ink)",
              }}
            >
              <span
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: "rgba(16,185,129,.15)",
                  color: "#10b981",
                  fontSize: 11,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                CD
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    margin: 0,
                    fontWeight: 700,
                    fontSize: 13,
                    color: "var(--ink)",
                  }}
                >
                  {engineConfig.originName}
                </p>
                <p
                  style={{
                    margin: "2px 0 0",
                    fontSize: 11,
                    color: "var(--muted)",
                  }}
                >
                  Ponto de Saída / Origem (Posição 0)
                </p>
              </div>
              <span
                style={{
                  fontSize: 10,
                  color: "#10b981",
                  fontWeight: 700,
                  background: "rgba(16,185,129,.12)",
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                ORIGEM
              </span>
            </div>
            {detailRoute.stops.map((s) => {
              const totalStops = detailRoute.stops.length;
              const loadStep =
                (s as any).loadingSequence ?? totalStops - s.position + 1;
              const loadZone =
                totalStops === 1
                  ? "PORTA"
                  : loadStep === 1
                    ? "FUNDO"
                    : loadStep === totalStops
                      ? "PORTA"
                      : "MEIO";
              const zoneColor =
                loadZone === "PORTA"
                  ? "#10b981"
                  : loadZone === "FUNDO"
                    ? "#6366f1"
                    : "#f59e0b";

              return (
                <div
                  key={s.position}
                  role="button"
                  tabIndex={0}
                  data-stop-index={s.position}
                  onClick={() => setSelectedDetailStop(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      setSelectedDetailStop(s);
                    }
                  }}
                  style={{
                    display: "flex",
                    width: "100%",
                    textAlign: "left",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 12px",
                    borderRadius: 9,
                    background:
                      selectedDetailStop?.position === s.position
                        ? "rgba(245,158,11,.12)"
                        : "var(--card-subtle)",
                    border:
                      selectedDetailStop?.position === s.position
                        ? "1px solid rgba(245,158,11,.5)"
                        : "1px solid var(--line)",
                    cursor: "pointer",
                    color: "inherit",
                  }}
                >
                  <StopDragHandle
                    index={s.position}
                    name={s.city}
                    disabled={false}
                    onMove={(fromIdx, toIdx) => {
                      const routeIndex = detailRoute.index;
                      setDetailRoute((prev) => {
                        if (!prev) return null;
                        const reordered = moveDeliveryStop(
                          [
                            {
                              position: 0,
                              city: engineConfig.originName,
                              is_origin: true,
                            } as any,
                            ...prev.stops,
                          ],
                          fromIdx,
                          toIdx,
                        );
                        const updatedStops = reordered
                          .slice(1)
                          .map((stop: any, idx: number) => {
                            const pos = idx + 1;
                            const total = reordered.length - 1;
                            return {
                              ...stop,
                              position: pos,
                              loadingSequence: total - pos + 1,
                            };
                          });
                        const nextRoute = { ...prev, stops: updatedStops };
                        const idxInResult = result.routes.findIndex(
                          (rt) => rt.index === routeIndex,
                        );
                        if (idxInResult >= 0) {
                          result.routes[idxInResult] = nextRoute;
                        }
                        return nextRoute;
                      });
                    }}
                  />
                  <span
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: "rgba(56,189,248,.15)",
                      color: "#38bdf8",
                      fontSize: 11,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {s.position}º
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0,
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--ink)",
                      }}
                    >
                      {s.city}
                    </p>
                    <p
                      style={{
                        margin: "2px 0 0",
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      {s.clientName || "—"} · {fmt(s.volumeM3)} m³ · {s.boxes} cx
                    </p>
                    <p
                      style={{
                        margin: "2px 0 0",
                        fontSize: 11,
                        color: "var(--muted)",
                      }}
                    >
                      Pedidos: {s.orders.map((o) => o.orderId).join(", ")}
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      gap: 3,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--muted)",
                        fontWeight: 600,
                      }}
                    >
                      Entrega #{s.position}
                    </span>
                    <span
                      className="lifo-loading-indicator"
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: zoneColor,
                        background: `${zoneColor}18`,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                      title={`Passo de carregamento: ${loadStep}º (${loadZone})`}
                    >
                      📦 {loadZone} ({loadStep}º)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p
            style={{
              margin: "0 0 8px",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: ".1em",
            }}
          >
            Atribuição desta rota
          </p>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
          >
            <label>
              <span style={{ ...S.label, color: "var(--muted)" }}>
                <Truck
                  size={11}
                  style={{ display: "inline", marginRight: 4 }}
                />
                Motorista
              </span>
              <select
                value={assignments[detailRoute.index]?.driverId ?? ""}
                onChange={(e) =>
                  setAssign(detailRoute.index, "driverId", e.target.value)
                }
                style={{
                  ...S.select,
                  background: "var(--card-subtle)",
                  color: "var(--ink)",
                  border: "1px solid var(--line)",
                }}
              >
                <option value="">— Selecionar motorista —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ ...S.label, color: "var(--muted)" }}>
                <FileSpreadsheet
                  size={11}
                  style={{ display: "inline", marginRight: 4 }}
                />
                Veículo
              </span>
              <select
                value={assignments[detailRoute.index]?.vehicleId ?? ""}
                onChange={(e) =>
                  setAssign(detailRoute.index, "vehicleId", e.target.value)
                }
                style={{
                  ...S.select,
                  background: "var(--card-subtle)",
                  color: "var(--ink)",
                  border: "1px solid var(--line)",
                }}
              >
                <option value="">— Selecionar veículo —</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.plate}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {err && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(239,68,68,.08)",
            border: "1px solid rgba(239,68,68,.25)",
            color: "#ef4444",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          ⚠ {err}
        </div>
      )}

      {/* Dispatch sticky bar */}
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
            {assignedCount} de {result.routes.length} rotas com motorista
            atribuído
          </strong>
          {assignedCount < result.routes.length && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              (Atribua na tabela acima ou no detalhe da rota)
            </span>
          )}
        </div>
        <button
          onClick={handleDispatch}
          disabled={dispatching || assignedCount === 0}
          style={{
            ...S.btnPrimary,
            background: assignedCount === 0 ? "var(--line)" : "#059669",
            color: assignedCount === 0 ? "var(--muted)" : "#fff",
            cursor: assignedCount === 0 ? "not-allowed" : "pointer",
            padding: "10px 22px",
            fontSize: 13,
            fontWeight: 700,
            opacity: dispatching ? 0.7 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {dispatching ? (
            <Loader2
              size={16}
              style={{ animation: "spin 1s linear infinite" }}
            />
          ) : (
            <Send size={16} />
          )}
          {dispatching
            ? "Salvando e despachando rotas..."
            : `Despachar ${assignedCount} ${assignedCount === 1 ? "rota" : "rotas"}`}
        </button>
      </div>
    </div>
  );
}

// ─── Step 4: Success ──────────────────────────────────────────────────────────

function SuccessStep({
  routeIds,
  onNew,
}: {
  routeIds: string[];
  onNew: () => void;
}) {
  return (
    <section
      style={{ maxWidth: 480, margin: "60px auto", textAlign: "center" }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "rgba(16,185,129,.15)",
          color: "var(--green)",
          marginBottom: 20,
        }}
      >
        <CheckCircle2 size={36} />
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 22 }}>
        Rotas despachadas com sucesso!
      </h2>
      <p style={{ color: "var(--muted)", margin: "0 0 24px", lineHeight: 1.55 }}>
        <strong style={{ color: "var(--ink)" }}>{routeIds.length} rotas</strong>{" "}
        criadas e atribuídas aos motoristas.
        <br />
        Eles já podem acessar as viagens no aplicativo.
      </p>
      <button onClick={onNew} style={S.btnPrimary}>
        Nova Importação
      </button>
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function RoteirizadorPage({
  onBack,
  onOpenInPlanner,
}: {
  onBack?: () => void;
  onOpenInPlanner?: (
    route: SuggestedRoute,
    config: ExtendedEngineConfig,
    routingProof?: string,
  ) => void;
}) {
  const [step, setStep] = useState<"upload" | "config" | "review" | "done">(
    "upload",
  );
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [filename, setFilename] = useState("");
  const [engineResult, setEngineResult] =
    useState<ExtendedEngineResult | null>(null);
  const [engineConfig, setEngineConfig] =
    useState<ExtendedEngineConfig | null>(null);
  const [vehiclePreset, setVehiclePreset] = useState("carreta");
  const [serviceMin, setServiceMin] = useState(40);
  const [speedKmh, setSpeedKmh] = useState(52);
  const [costPctMin, setCostPctMin] = useState(3);
  const [costPctMax, setCostPctMax] = useState(5);
  const [minVolDed, setMinVolDed] = useState(20);
  const [freightFilter, setFreightFilter] = useState<FreightFilter>("Todos");
  const [dispatchedIds, setDispatchedIds] = useState<string[]>([]);
  const resetNonceRef = useRef(0);
  const currentNonce = resetNonceRef.current;

  const reset = () => {
    resetNonceRef.current++;
    setStep("upload");
    setRows([]);
    setFilename("");
    setEngineResult(null);
    setEngineConfig(null);
    setDispatchedIds([]);
    setFreightFilter("Todos");
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === WORKBOOK_CONFIRMED_EVENT) reset();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const steps = [
    { key: "upload", label: "1. Upload" },
    { key: "config", label: "2. Configurar" },
    { key: "review", label: "3. Rotas" },
    { key: "done", label: "4. Concluído" },
  ];
  const stepIdx = steps.findIndex((s) => s.key === step);

  return (
    <div
      className="routing-wizard"
      style={{
        minHeight: "100dvh",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <header
        style={{
          borderBottom: "1px solid var(--line)",
          background: "var(--card)",
          padding: "0 24px",
        }}
      >
        <div
          className="routing-wizard-header"
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 14,
            height: 58,
          }}
        >
          {onBack && (
            <button onClick={onBack} style={S.btnSecondary}>
              <ArrowLeft size={14} /> Voltar
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <FileSpreadsheet size={18} color="var(--green)" />
            <b style={{ fontSize: 15, letterSpacing: "-.02em" }}>
              Roteirizador Automático
            </b>
          </div>
          <div style={{ marginLeft: "auto" }}>
            {step !== "done" && (
              <button onClick={reset} style={S.btnSecondary}>
                <X size={12} /> Reiniciar
              </button>
            )}
          </div>
        </div>
      </header>
      <div
        style={{
          borderBottom: "1px solid var(--line)",
          background: "var(--card-subtle)",
          padding: "0 24px",
        }}
      >
        <div
          className="routing-wizard-steps"
          style={{ maxWidth: 1400, margin: "0 auto", display: "flex" }}
        >
          {steps.map((s, i) => (
            <div
              key={s.key}
              style={{
                padding: "9px 14px",
                fontSize: 12,
                fontWeight: 700,
                color: i <= stepIdx ? "var(--green)" : "var(--muted)",
                borderBottom:
                  i === stepIdx
                    ? "2px solid var(--green)"
                    : "2px solid transparent",
                transition: "all .2s",
              }}
            >
              {s.label}
            </div>
          ))}
        </div>
      </div>
      <main
        className="routing-wizard-content"
        style={{ maxWidth: 1400, margin: "0 auto", padding: "24px" }}
      >
        {step === "upload" && (
          <UploadStep
            onParsed={(r, f) => {
              if (currentNonce === resetNonceRef.current) {
                setRows(r);
                setFilename(f);
                setStep("config");
              }
            }}
          />
        )}
        {step === "config" && (
          <ConfigStep
            rows={rows}
            filename={filename}
            onBack={() => setStep("upload")}
            onGenerate={(
              result,
              config,
              vehicle,
              svcMin,
              speed,
              cMin,
              cMax,
              minVol,
              ff,
            ) => {
              if (currentNonce === resetNonceRef.current) {
                setEngineResult(result);
                setEngineConfig(config);
                setVehiclePreset(vehicle);
                setServiceMin(svcMin);
                setSpeedKmh(speed);
                setCostPctMin(cMin);
                setCostPctMax(cMax);
                setMinVolDed(minVol);
                setFreightFilter(ff);
                setStep("review");
              }
            }}
          />
        )}
        {step === "review" && engineResult && engineConfig && (
          <ResultsTable
            result={engineResult}
            filename={filename}
            engineConfig={engineConfig}
            vehiclePreset={vehiclePreset}
            serviceMin={serviceMin}
            speedKmh={speedKmh}
            costPctMin={costPctMin}
            costPctMax={costPctMax}
            minVolDed={minVolDed}
            freightFilter={freightFilter}
            onBack={() => setStep("config")}
            onDispatched={(ids) => {
              setDispatchedIds(ids);
              setStep("done");
            }}
            onOpenInPlanner={onOpenInPlanner}
          />
        )}
        {step === "done" && (
          <SuccessStep routeIds={dispatchedIds} onNew={reset} />
        )}
      </main>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export function buildSuggestedPlannerStops(
  suggested: SuggestedRoute,
  config: ExtendedEngineConfig,
) {
  return [
    {
      name: config.originName
        ? `Origem (${config.originName})`
        : "Origem (CD Base)",
      address: "Base Operacional de Distribuição",
      lat: config.originLat,
      lng: config.originLng,
      is_origin: true,
    },
    ...suggested.stops.map((stop) => ({
      name: stop.clientName ? `${stop.clientName} - ${stop.city}` : stop.city,
      address: stop.address || stop.city,
      lat: stop.lat,
      lng: stop.lng,
      boxes: stop.boxes,
      volume_m3: stop.volumeM3,
      order_ids: [...new Set(stop.orders.map((order) => order.orderId))],
      is_origin: false,
    })),
  ];
}

export function plannerStopContentKey(stop: {
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_origin?: boolean;
  boxes?: number | null;
  volume_m3?: number | null;
  order_ids?: string[] | null;
}): string {
  return JSON.stringify([
    stop.name,
    stop.address,
    stop.lat,
    stop.lng,
    !!stop.is_origin,
    stop.boxes ?? null,
    stop.volume_m3 ?? null,
    stop.order_ids ?? [],
  ]);
}

export type RoutingProof = string;

export default RoteirizadorPage;


