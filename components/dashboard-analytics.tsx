"use client";

import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  Target,
  Clock,
  MapPin,
  Flame,
  Award,
  Calendar,
  DollarSign,
  Truck,
  RefreshCw,
"use client";

import React, { useState, useEffect } from "react";
import {
  TrendingUp,
  Target,
  Clock,
  MapPin,
  Flame,
  Award,
  Calendar,
  DollarSign,
  Truck,
  RefreshCw,
  Edit2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { haptics } from "@/lib/haptics";

interface AnalyticsData {
  month: string;
  targetKm: number;
  targetDeliveries: number;
  realizedKm: number;
  realizedDeliveries: number;
  totalRevenue: number;
  totalEstimatedFuel: number;
  costPerKm?: number;
  costRatioPct?: number;
  otifPct?: number;
  fleetStatus?: {
    active: number;
    assigned: number;
    completed: number;
    total: number;
  };
  driverRanking?: Array<{
    name: string;
    routes: number;
    deliveries: number;
    km: number;
  }>;
  projection: {
    dailyAvgKm: number;
    projectedTotalKm: number;
    pctCurrent: number;
    projectedPctMonthEnd: number;
    forecastStatusText: string;
    forecastBeatDay: number | null;
  };
  historyDays: Array<{
    date: string;
    km: number;
    deliveries: number;
    routes: number;
  }>;
  heatPoints: Array<[number, number, number]>;
  topCities: Array<{ city: string; count: number; lat: number; lng: number }>;
  clientScores: Array<{
    name: string;
    total: number;
    completed: number;
    score: number;
    status: string;
  }>;
}

export function DashboardAnalytics({
  userRole,
  onOpenHeatmap,
}: {
  userRole?: string;
  onOpenHeatmap?: (points: Array<[number, number, number]>) => void;
}) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetKmInput, setTargetKmInput] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/analytics/summary");
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setTargetKmInput(String(json.targetKm || 5000));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    haptics.tap();
    setSavingTarget(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: data?.month,
          target_km: Number(targetKmInput),
          target_deliveries: data?.targetDeliveries || 200,
        }),
      });
      if (res.ok) {
        haptics.success();
        setEditingTarget(false);
        loadData();
      }
    } catch (err) {
      haptics.error();
    } finally {
      setSavingTarget(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="analytics-loading-skeleton" style={{ padding: "20px", textAlign: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: "14px" }}>Carregando dados analíticos e metas...</p>
      </div>
    );
  }

  if (!data) return null;

  const pct = Math.min(100, data.projection.pctCurrent || 0);

  return (
    <section className="panel analytics-panel" style={{ marginBottom: 18, borderRadius: 18, border: "1px solid var(--line)" }}>
      <div className="panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <TrendingUp size={20} color="#2563eb" /> Inteligência Logística & Performance da Frota
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>
            Painel executivo de OTIF, custos de frete, metas e distribuição geográfica
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {onOpenHeatmap && (
            <button
              type="button"
              className="button secondary compact"
              onClick={() => {
                haptics.tap();
                onOpenHeatmap(data.heatPoints);
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, height: 34, background: "rgba(234,88,12,0.1)", color: "#ea580c", border: "1px solid rgba(234,88,12,0.25)" }}
            >
              <Flame size={15} color="#ea580c" /> Heatmap de Cidades ({data.heatPoints.length})
            </button>
          )}
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              haptics.tap();
              loadData();
            }}
            title="Recarregar dados"
            style={{ height: 34, padding: "0 8px" }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Faixa de KPIs Logísticos Executivos */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 14 }}>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Nível de Serviço (OTIF)</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#10b981", marginTop: 4 }}>{data.otifPct || 95}%</div>
          <small style={{ fontSize: 11, color: "var(--muted)" }}>Prazo & integridade</small>
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Custo por KM</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", marginTop: 4 }}>R$ {data.costPerKm || "3,85"}</div>
          <small style={{ fontSize: 11, color: "var(--muted)" }}>Combustível & diárias</small>
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Custo / Carga (% VFR)</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#3b82f6", marginTop: 4 }}>{data.costRatioPct || 4.2}%</div>
          <small style={{ fontSize: 11, color: "var(--muted)" }}>Frete sobre faturamento</small>
        </div>
        <div style={{ padding: "12px 14px", borderRadius: 12, background: "var(--card-subtle)", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Rotas Ativas</span>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b", marginTop: 4 }}>{data.fleetStatus?.active || 0} / {data.fleetStatus?.total || 0}</div>
          <small style={{ fontSize: 11, color: "var(--muted)" }}>Veículos em trânsito</small>
        </div>
      </div>

      {/* Grid Principal: Meta vs Realizado */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 14 }}>
        
        {/* Card 1: Meta de KM com Barra de Progresso e Edição pelo ADM */}
        <div
          style={{
            padding: "16px",
            borderRadius: "14px",
            background: "var(--card-subtle, #f8fafc)",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5 }}>
              <Target size={15} color="#2563eb" /> Meta Mensal de KM
            </span>
            {(userRole === "admin" || userRole === "superadmin") && !editingTarget && (
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  setEditingTarget(true);
                }}
                style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}
              >
                <Edit2 size={12} /> Alterar Meta
              </button>
            )}
          </div>

          {editingTarget ? (
            <form onSubmit={handleSaveTarget} style={{ display: "flex", gap: 6, margin: "8px 0" }}>
              <input
                type="number"
                value={targetKmInput}
                onChange={(e) => setTargetKmInput(e.target.value)}
                style={{
                  height: 36,
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                  padding: "0 8px",
                  fontSize: 14,
                  fontWeight: 700,
                  width: "100%",
                }}
                placeholder="Ex: 6500"
                autoFocus
              />
              <button type="submit" disabled={savingTarget} className="button primary compact" style={{ height: 36, padding: "0 12px" }}>
                Salvar
              </button>
              <button
                type="button"
                onClick={() => setEditingTarget(false)}
                className="button secondary compact"
                style={{ height: 36, padding: "0 8px" }}
              >
                ✕
              </button>
            </form>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "6px 0 10px" }}>
              <strong style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)" }}>
                {data.realizedKm.toLocaleString("pt-BR")}
              </strong>
              <span style={{ fontSize: 14, color: "var(--muted)" }}>
                / {data.targetKm.toLocaleString("pt-BR")} km ({pct}%)
              </span>
            </div>
          )}

          {/* Barra de Progresso com Gradiente */}
          <div style={{ width: "100%", height: 10, background: "rgba(0,0,0,0.06)", borderRadius: 99, overflow: "hidden", margin: "4px 0" }}>
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: pct >= 100 ? "#10b981" : "linear-gradient(90deg, #3b82f6, #2563eb)",
                borderRadius: 99,
                transition: "width 0.6s ease",
              }}
            />
          </div>

          {/* Previsibilidade de Fechamento */}
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.15)", fontSize: 12, color: "#1d4ed8" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, marginBottom: 2 }}>
              <Award size={14} /> Previsibilidade de Fechamento:
            </div>
            <span>{data.projection.forecastStatusText}</span>
          </div>
        </div>

        {/* Card 2: Produtividade dos Motoristas */}
        <div
          style={{
            padding: "16px",
            borderRadius: "14px",
            background: "var(--card-subtle, #f8fafc)",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
            <Truck size={15} color="#059669" /> Produtividade de Motoristas
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 150 }}>
            {!data.driverRanking || data.driverRanking.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "auto" }}>Nenhum motorista alocado no período.</p>
            ) : (
              data.driverRanking.map((drv, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, borderBottom: "1px solid rgba(0,0,0,0.04)", paddingBottom: 4 }}>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#059669", color: "#fff", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800 }}>
                      {i + 1}
                    </span>
                    {drv.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{drv.deliveries} entregas</span>
                    <strong style={{ fontSize: 11, color: "var(--ink)" }}>{drv.km} km</strong>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Card 3: Top Cidades com Maior Volume */}
        <div
          style={{
            padding: "16px",
            borderRadius: "14px",
            background: "var(--card-subtle, #f8fafc)",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
            <MapPin size={15} color="#ea580c" /> Cidades com Maior Volume
          </span>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.topCities.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted)", margin: "auto" }}>Nenhum ponto registrado.</p>
            ) : (
              data.topCities.slice(0, 4).map((city, idx) => (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
                  <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#ea580c", color: "#fff", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800 }}>
                      {idx + 1}
                    </span>
                    {city.city}
                  </span>
                  <span style={{ fontWeight: 700, color: "var(--muted)" }}>{city.count} paradas</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
