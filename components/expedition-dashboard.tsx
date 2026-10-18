"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  LiveFleetMap,
  formatLastPositionTime,
  type ActiveRoutePoint,
} from "./live-fleet-map";
import { onWorkbookConfirmed } from "./roteirizador-page";
import styles from "./expedition-dashboard.module.css";

export type MonetaryAmount = {
  status: "AVAILABLE" | "PARTIAL" | "UNKNOWN";
  value: number | null;
  knownValue: number | null;
  unknownCount: number;
  reason: string | null;
};

export type DashboardCardMetric = {
  status: "AVAILABLE" | "PARTIAL" | "UNKNOWN";
  count: number | null;
  itemCount?: number | null;
  amount: MonetaryAmount;
  percentageOfOrders: number | null;
  reason: string | null;
};

export type BreakdownRow = {
  category: string;
  count: number;
  amount: MonetaryAmount;
  percentageOfOrders: number | null;
  percentageOfAmount: number | null;
};

export type GeoBreakdownGroup = {
  key: string;
  uf: string | null;
  city: string | null;
  originalCityNames?: string[];
  count: number;
  amount: MonetaryAmount;
  percentageOfOrders: number | null;
  percentageOfAmount: number | null;
  freight?: BreakdownRow[];
  map?: BreakdownRow[];
  unknownMapCount?: number;
  precheckEligibleCount?: number;
  eligibleCount?: number | null;
  eligibilityStatus?: string;
  weightSource?: MonetaryAmount;
  volumeSource?: MonetaryAmount;
};

export type FunnelStage = {
  id: string;
  label: string;
  status: "AVAILABLE" | "PARTIAL" | "UNKNOWN";
  inputCount: number | null;
  outputCount: number | null;
  excludedCount: number | null;
  unknownCount: number;
  percentageOfPrevious: number | null;
  percentageOfTotal: number | null;
  amount: MonetaryAmount;
  exclusionReasons: { code: string; count: number }[];
};

export type DataQualityAlert = {
  type: string;
  severity: "WARNING" | "ERROR";
  count: number;
  unit: "ITEM" | "ORDER" | "INVOICE" | "IMPORT";
  message: string;
  detailsAvailable: boolean;
};

export type SnapshotMetadata = {
  activeImportId: string | null;
  snapshotFingerprint: string | null;
  filename: string | null;
  competence: string | null;
  importedAt: string | null;
  sourceUpdatedAt: string | null;
  source: string;
  sheet: string | null;
  period?: {
    month: string;
    from: string;
    to: string;
    column: string;
  };
  itemCount: number;
  orderCount: number;
  unassociatedItemCount: number;
};

export type ExpeditionSnapshot = {
  contractVersion: string;
  monetaryUnit: string;
  snapshotStatus: "AVAILABLE" | "EMPTY" | "NO_WORKBOOK" | "SOURCE_UNAVAILABLE";
  metadata: SnapshotMetadata;
  cards: {
    billing: DashboardCardMetric;
    toBill?: DashboardCardMetric;
    portfolio: DashboardCardMetric;
    inMap: DashboardCardMetric;
    partialMap: DashboardCardMetric;
    outOfMap: DashboardCardMetric;
    cif: DashboardCardMetric;
    fob: DashboardCardMetric;
    routeEligible: DashboardCardMetric;
  };
  eligibilityFunnel: FunnelStage[];
  byState: GeoBreakdownGroup[];
  byCity: GeoBreakdownGroup[];
  freightBreakdown: BreakdownRow[];
  mapBreakdown: BreakdownRow[];
  unknownMapCount: number;
  dataQuality: DataQualityAlert[];
};

export type TraceSelection = {
  metric:
    | "toBill"
    | "portfolio"
    | "cif"
    | "fob"
    | "unknown"
    | "inMap"
    | "outOfMap"
    | "partialMap"
    | "state"
    | "city";
  key?: string;
};

const formatCount = (value: number | null | undefined) =>
  value == null ? "Indisponível" : new Intl.NumberFormat("pt-BR").format(value);

const formatPercent = (value: number | null | undefined) =>
  value == null
    ? "Não avaliado"
    : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;

export function formatMoney(amount: MonetaryAmount | null | undefined) {
  if (amount && amount.status === "AVAILABLE" && amount.value != null) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount.value / 100);
  }
  return amount?.status === "PARTIAL"
    ? "Valor parcialmente conhecido"
    : "Indisponível";
}

const CATEGORY_LABELS: Record<string, string> = {
  CIF: "CIF",
  FOB: "FOB",
  UNKNOWN: "Não classificado",
  IN_MAP: "Em mapa",
  PARTIALLY_IN_MAP: "Parcialmente em mapa",
  OUT_OF_MAP: "Fora de mapa",
};

const EXCLUSION_REASON_LABELS: Record<string, string> = {
  ALREADY_IN_MAP: "Pedido já em mapa",
  PARTIAL_MAP: "Pedido parcialmente em mapa",
  INSUFFICIENT_STOCK: "Saldo insuficiente",
  OPERATIONAL_STATUS_BLOCKED: "Situação operacional bloqueada",
  OPERATIONAL_STATUS_FILTER: "Situação operacional bloqueada",
  MIXED_OPERATIONAL_STATUS: "Situação operacional mista",
  UNKNOWN_DATA: "Dados não comprovados",
  UNKNOWN_FREIGHT: "Frete não classificado",
  FOB: "Frete FOB",
  CAPACITY_EXCEEDED: "Capacidade excedida",
  MINIMUM_ORDER_NOT_MET: "Mínimo por UF não atendido",
};

const COLORS: Record<string, string> = {
  CIF: "#059669",
  FOB: "#64748b",
  UNKNOWN: "#b7791f",
  IN_MAP: "#059669",
  PARTIALLY_IN_MAP: "#b7791f",
  OUT_OF_MAP: "#64748b",
};

const formatCategoryLabel = (cat: string) =>
  cat === "UNKNOWN"
    ? "Não classificado"
    : cat === "PARTIALLY_IN_MAP"
      ? "Parcial"
      : CATEGORY_LABELS[cat] ?? cat;

const formatBreakdownSummary = (row: BreakdownRow) =>
  `${formatCategoryLabel(row.category)} · ${formatCount(row.count)} pedidos · ${formatMoney(row.amount)} · ${formatPercent(row.percentageOfOrders)}`;

function KpiCard({
  title,
  card,
  billing = false,
  tone = "neutral",
  onDetail,
}: {
  title: string;
  card: DashboardCardMetric;
  billing?: boolean;
  tone?: "neutral" | "positive" | "caution" | "critical";
  onDetail?: () => void;
}) {
  return (
    <article className={styles.card} data-tone={tone}>
      <h3>{title}</h3>
      <strong className={styles.number}>
        {billing
          ? card.status === "AVAILABLE"
            ? formatMoney(card.amount)
            : "Indisponível"
          : formatCount(card.count)}
      </strong>
      <p>
        {onDetail ? (
          <button
            type="button"
            className={styles.traceLink}
            onClick={onDetail}
            aria-label={`Detalhar ${title}`}
          >
            {formatMoney(card.amount)}
          </button>
        ) : billing ? (
          card.status === "AVAILABLE" ? (
            "Filial 281 · produtos ativos"
          ) : (
            <span
              className={`${styles.statusBadge} statusBadge`}
              data-status="pending"
            >
              Validação pendente
            </span>
          )
        ) : (
          formatMoney(card.amount)
        )}
      </p>
      {!billing && <small>{formatPercent(card.percentageOfOrders)} da carteira</small>}
    </article>
  );
}

function SecondaryMetrics({
  cards,
  freight,
  onDetail,
}: {
  cards: ExpeditionSnapshot["cards"];
  freight: BreakdownRow[];
  onDetail?: (metric: TraceSelection["metric"]) => void;
}) {
  const standardItems: [
    "cif" | "fob" | "partialMap" | "outOfMap",
    string,
  ][] = [
    ["cif", "CIF"],
    ["fob", "FOB"],
    ["partialMap", "Parcialmente em mapa"],
    ["outOfMap", "Fora do mapa"],
  ];

  return (
    <dl className={styles.secondary} aria-label="Indicadores secundários da carteira">
      {cards.toBill && (
        <div>
          <dt>
            <span>A faturar</span>
            <button
              type="button"
              className={`${styles.tooltipTrigger} tooltip-trigger`}
              aria-label="Nota metodológica sobre A faturar"
              aria-describedby="tooltip-tobill"
            >
              <span aria-hidden="true" className={styles.infoIcon}>
                ⓘ
              </span>
              <span
                id="tooltip-tobill"
                role="tooltip"
                className={`${styles.tooltipBubble} tooltip-bubble`}
                data-position="top"
              >
                Total Item das linhas sem data de faturamento; não representa o
                saldo exato das baixas parciais.
              </span>
            </button>
          </dt>
          <dd>
            {formatCount(cards.toBill.count)} pedidos{" "}
            <small>{formatCount(cards.toBill.itemCount)} itens</small>
            <span className={styles.secondaryAmount}>
              {onDetail && cards.toBill.status !== "UNKNOWN" ? (
                <button
                  type="button"
                  className={styles.traceLink}
                  onClick={() => onDetail("toBill")}
                  aria-label="Detalhar A faturar"
                >
                  {formatMoney(cards.toBill.amount)}
                </button>
              ) : (
                formatMoney(cards.toBill.amount)
              )}
            </span>
          </dd>
        </div>
      )}
      {standardItems.map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {formatCount(cards[key].count)}{" "}
            <small>{formatPercent(cards[key].percentageOfOrders)}</small>
            <span className={styles.secondaryAmount}>
              {onDetail ? (
                <button
                  type="button"
                  className={styles.traceLink}
                  onClick={() => onDetail(key)}
                  aria-label={`Detalhar ${label}`}
                >
                  {formatMoney(cards[key].amount)}
                </button>
              ) : (
                formatMoney(cards[key].amount)
              )}
            </span>
          </dd>
        </div>
      ))}
      {freight
        .filter((f) => f.category === "UNKNOWN")
        .map((f) => (
          <div key={f.category}>
            <dt>Frete não classificado</dt>
            <dd>
              {formatCount(f.count)}{" "}
              <small>{formatPercent(f.percentageOfOrders)}</small>
              <span className={styles.secondaryAmount}>
                {onDetail ? (
                  <button
                    type="button"
                    className={styles.traceLink}
                    onClick={() => onDetail("unknown")}
                    aria-label="Detalhar frete desconhecido"
                  >
                    {formatMoney(f.amount)}
                  </button>
                ) : (
                  formatMoney(f.amount)
                )}
              </span>
            </dd>
          </div>
        ))}
    </dl>
  );
}

const FUNNEL_STAGE_SHORT_LABELS: Record<string, string> = {
  PORTFOLIO: "Carteira",
  MAP_STOCK: "Mapa / saldo",
  CIF: "CIF",
  MINIMUM_CAPACITY: "Mínimo UF",
};

function EligibilityFunnel({ stages }: { stages: FunnelStage[] }) {
  return (
    <section className={styles.funnelSection} aria-label="Funil de elegibilidade">
      <header>
        <p className={styles.eyebrow}>CARTEIRA · EXPEDIÇÃO</p>
        <h2>Funil de elegibilidade</h2>
      </header>
      <ol className={styles.funnel}>
        {stages
          .filter((s) => FUNNEL_STAGE_SHORT_LABELS[s.id])
          .map((stage) => (
            <li
              key={stage.id}
              className={styles.stage}
              tabIndex={0}
              aria-describedby={`funnel-${stage.id}`}
            >
              <strong>{formatCount(stage.outputCount)}</strong>
              <span>{FUNNEL_STAGE_SHORT_LABELS[stage.id]}</span>
              <small>{formatPercent(stage.percentageOfTotal)} da carteira</small>
              <div
                className={styles.tooltip}
                id={`funnel-${stage.id}`}
                role="tooltip"
              >
                <strong>{stage.label}</strong>
                <p>{formatPercent(stage.percentageOfPrevious)} da etapa anterior</p>
                <p>
                  {formatMoney(stage.amount)} · {formatCount(stage.excludedCount)}{" "}
                  excluídos
                </p>
                {stage.exclusionReasons.map((reason) => (
                  <p key={reason.code}>
                    {EXCLUSION_REASON_LABELS[reason.code] ?? "Regra operacional"}:{" "}
                    {formatCount(reason.count)}
                  </p>
                ))}
                {stage.status === "UNKNOWN" && <p>Ainda não avaliado.</p>}
                {stage.unknownCount > 0 && (
                  <p>{formatCount(stage.unknownCount)} pedidos indeterminados.</p>
                )}
              </div>
            </li>
          ))}
      </ol>
      <p className={styles.caption}>
        Pré-checks não significam rotas prontas. Geocodificação e alocação ainda
        não avaliadas.
      </p>
    </section>
  );
}

function StateDistributionChart({
  groups,
  cities = [],
  onDetail,
}: {
  groups: GeoBreakdownGroup[];
  cities?: GeoBreakdownGroup[];
  onDetail?: (sel: TraceSelection) => void;
}) {
  const [mode, setMode] = useState<"value" | "count">("value");
  const [selectedCityKey, setSelectedCityKey] = useState("");
  const selectId = useId();
  const activeCity = cities.find((c) => c.key === selectedCityKey);

  const sorted = [...groups]
    .sort((a, b) => {
      if (mode === "count") {
        return b.count - a.count || a.key.localeCompare(b.key);
      }
      const valB = b.amount.value ?? b.amount.knownValue ?? -1;
      const valA = a.amount.value ?? a.amount.knownValue ?? -1;
      return valB - valA || a.key.localeCompare(b.key);
    })
    .slice(0, groups.length);

  const getVal = (g: GeoBreakdownGroup) =>
    mode === "count" ? g.count : g.amount.value;
  const minVal = Math.min(0, ...sorted.map((g) => getVal(g) ?? 0));
  const range =
    Math.max(0, ...sorted.map((g) => getVal(g) ?? 0)) - minVal || 1;
  const zeroX = (-minVal / range) * 1000;

  return (
    <section
      className={`${styles.chart} ${styles.stateChart}`}
      aria-label="Distribuição por estado"
      data-home-chart="states"
    >
      <header className={styles.heading}>
        <h2>Distribuição por estado</h2>
        <div className={styles.toggle} aria-label="Medida por estado">
          {(["value", "count"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === "value" ? "Valor" : "Pedidos"}
            </button>
          ))}
        </div>
      </header>
      <p className={styles.caption}>
        {mode === "value" ? "Valor da carteira (R$)" : "Pedidos da carteira"} ·
        maior para menor
      </p>
      <div
        className={styles.stateScroll}
        tabIndex={0}
        role="region"
        aria-label="Todos os estados — role para ver mais"
      >
        {!sorted.length && <p>Nenhum estado informado.</p>}
        <ol className={styles.stateBars}>
          {sorted.map((item) => {
            const val = getVal(item);
            const barX = (((val ?? 0) - minVal) / range) * 1000;
            const ufLabel = item.uf ?? "N/I";
            const formattedVal =
              mode === "count" ? formatCount(item.count) : formatMoney(item.amount);
            return (
              <li
                key={item.key}
                title={`${ufLabel} · ${formatCount(item.count)} pedidos · ${formatMoney(item.amount)} · ${formatPercent(mode === "count" ? item.percentageOfOrders : item.percentageOfAmount)}`}
              >
                <span>{ufLabel}</span>
                <svg
                  viewBox="0 0 1000 28"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${ufLabel}: ${formattedVal}`}
                >
                  <line
                    x1={zeroX}
                    x2={zeroX}
                    y1="0"
                    y2="28"
                    className={styles.axis}
                  />
                  {val !== null && (
                    <rect
                      x={Math.min(zeroX, barX)}
                      y="4"
                      width={Math.abs(barX - zeroX)}
                      height="20"
                      rx="3"
                      fill={COLORS.CIF}
                    />
                  )}
                </svg>
                <strong>
                  {onDetail ? (
                    <button
                      type="button"
                      className={styles.traceLink}
                      aria-label={`Detalhar UF ${ufLabel}`}
                      onClick={() => onDetail({ metric: "state", key: item.key })}
                    >
                      {formattedVal}
                    </button>
                  ) : (
                    formattedVal
                  )}
                </strong>
              </li>
            );
          })}
        </ol>
      </div>
      {cities.length > 0 && (
        <details className={styles.cityValues}>
          <summary>Consultar valores por cidade</summary>
          <label htmlFor={selectId}>Cidade / UF</label>
          <select
            id={selectId}
            value={activeCity?.key ?? ""}
            onChange={(e) => setSelectedCityKey(e.target.value)}
          >
            <option value="">Selecione uma cidade</option>
            {cities.map((c) => (
              <option key={c.key} value={c.key}>
                {c.city ?? "Não informada"} / {c.uf ?? "N/I"}
              </option>
            ))}
          </select>
          {activeCity && (
            <p role="status">
              {formatMoney(activeCity.amount)} · {formatCount(activeCity.count)}{" "}
              pedidos · {formatPercent(activeCity.percentageOfAmount)} do valor
              da carteira
            </p>
          )}
        </details>
      )}
      {activeCity && onDetail && (
        <button
          type="button"
          className={styles.traceLink}
          onClick={() => onDetail({ metric: "city", key: activeCity.key })}
        >
          Ver pedidos de {activeCity.city ?? "cidade desconhecida"} /{" "}
          {activeCity.uf ?? "UF desconhecida"}
        </button>
      )}
    </section>
  );
}

function BreakdownLegend({
  rows,
  onActive,
  onDetail,
}: {
  rows: BreakdownRow[];
  onActive: (cat: string | null) => void;
  onDetail?: (cat: string) => void;
}) {
  return (
    <ul className={styles.legend}>
      {rows.map((row) => (
        <li key={row.category}>
          <button
            type="button"
            aria-label={formatBreakdownSummary(row)}
            onFocus={() => onActive(row.category)}
            onBlur={() => onActive(null)}
            onMouseEnter={() => onActive(row.category)}
            onMouseLeave={() => onActive(null)}
            onClick={() => {
              onActive(row.category);
              onDetail?.(row.category);
            }}
          >
            <span
              className={styles.swatch}
              style={{ background: COLORS[row.category] ?? COLORS.UNKNOWN }}
            />
            <span>{formatCategoryLabel(row.category)}</span>
            <strong>{formatCount(row.count)}</strong>
            <small>{formatPercent(row.percentageOfOrders)}</small>
            <span className={styles.legendAmount}>
              {row.category === "PARTIALLY_IN_MAP"
                ? "Valor dos pedidos parcialmente em mapa: "
                : ""}
              {formatMoney(row.amount)} · {formatPercent(row.percentageOfAmount)}{" "}
              do valor
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CifFobChart({
  rows,
  onDetail,
}: {
  rows: BreakdownRow[];
  onDetail?: (sel: TraceSelection) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const titleId = useId();
  const visibleRows = rows.filter(
    (r) => r.category !== "UNKNOWN" || r.count > 0,
  );
  const activeRow = visibleRows.find((r) => r.category === activeCategory);
  let cumulative = 0;

  return (
    <section
      className={styles.chart}
      aria-labelledby={titleId}
      data-home-chart="freight"
    >
      <h2 id={titleId}>CIF × FOB</h2>
      <div className={styles.donutLayout}>
        <svg
          className={styles.donut}
          viewBox="0 0 160 160"
          role="img"
          aria-label="Distribuição dos pedidos por frete"
        >
          <circle
            cx="80"
            cy="80"
            r="58"
            fill="none"
            stroke="var(--line)"
            strokeWidth="23"
          />
          {visibleRows.map((row) => {
            const pct = row.percentageOfOrders ?? 0;
            const offset = cumulative;
            cumulative += pct;
            return (
              pct > 0 && (
                <circle
                  key={row.category}
                  cx="80"
                  cy="80"
                  r="58"
                  fill="none"
                  stroke={COLORS[row.category] ?? COLORS.UNKNOWN}
                  strokeWidth="23"
                  pathLength="100"
                  strokeDasharray={`${pct} ${100 - pct}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 80 80)"
                  onMouseEnter={() => setActiveCategory(row.category)}
                  onMouseLeave={() => setActiveCategory(null)}
                >
                  <title>{formatBreakdownSummary(row)}</title>
                </circle>
              )
            );
          })}
          <text
            x="80"
            y="83"
            textAnchor="middle"
            className={styles.donutLabel}
          >
            Frete
          </text>
        </svg>
        <BreakdownLegend
          rows={visibleRows}
          onActive={setActiveCategory}
          onDetail={
            onDetail
              ? (cat) =>
                  onDetail({
                    metric:
                      cat === "CIF" ? "cif" : cat === "FOB" ? "fob" : "unknown",
                  })
              : undefined
          }
        />
      </div>
      <p className={styles.chartDetail} role="status">
        {activeRow
          ? formatBreakdownSummary(activeRow)
          : "Gráfico e percentual superior: pedidos. Valores e participação monetária abaixo."}
      </p>
    </section>
  );
}

function MapStatusChart({
  rows,
  unknownMapCount,
  onDetail,
}: {
  rows: BreakdownRow[];
  unknownMapCount: number;
  onDetail?: (sel: TraceSelection) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const activeRow = rows.find((r) => r.category === activeCategory);
  let currentX = 0;

  return (
    <section
      className={`${styles.chart} ${styles.mapStatusChart}`}
      aria-label="Situação da carteira"
      data-home-chart="map-status"
    >
      <h2>Situação da carteira</h2>
      <svg
        className={styles.stackedBar}
        viewBox="0 0 1000 24"
        preserveAspectRatio="none"
        role="img"
        aria-label="Proporção de pedidos em mapa, parciais e fora do mapa"
      >
        <rect width="1000" height="24" fill="var(--line)" />
        {rows.map((row) => {
          const width = (row.percentageOfOrders ?? 0) * 10;
          const x = currentX;
          currentX += width;
          return (
            <rect
              key={row.category}
              x={x}
              width={width}
              height="24"
              fill={COLORS[row.category] ?? COLORS.UNKNOWN}
              onMouseEnter={() => setActiveCategory(row.category)}
              onMouseLeave={() => setActiveCategory(null)}
            >
              <title>{formatBreakdownSummary(row)}</title>
            </rect>
          );
        })}
      </svg>
      <BreakdownLegend
        rows={rows}
        onActive={setActiveCategory}
        onDetail={
          onDetail
            ? (cat) =>
                onDetail({
                  metric:
                    cat === "IN_MAP"
                      ? "inMap"
                      : cat === "OUT_OF_MAP"
                        ? "outOfMap"
                        : "partialMap",
                })
            : undefined
        }
      />
      <p className={styles.caption}>
        Valor dos pedidos parcialmente em mapa: pedido inteiro, não somente a
        parcela alocada.
      </p>
      <p className={styles.chartDetail} role="status">
        {activeRow
          ? formatBreakdownSummary(activeRow)
          : unknownMapCount > 0
            ? `${formatCount(unknownMapCount)} pedidos sem classificação de mapa`
            : "Participação na carteira completa"}
      </p>
    </section>
  );
}

const ALERT_UNIT_LABELS: Record<DataQualityAlert["unit"], string> = {
  ITEM: "itens",
  ORDER: "pedidos",
  INVOICE: "notas",
  IMPORT: "importação",
};

function DataQualitySection({ alerts }: { alerts: DataQualityAlert[] }) {
  const nfMismatch = alerts.find((a) => a.type === "NF_VALUE_MISMATCH");
  const statusUnvalidated = alerts.find(
    (a) => a.type === "PRODUCT_STATUS_NOT_VALIDATED",
  );

  return (
    <section className={styles.quality} aria-label="Qualidade dos dados">
      <div className={styles.heading}>
        <h2>Qualidade dos dados</h2>
        <div className={styles.qualitySummary}>
          {nfMismatch && (
            <span>{formatCount(nfMismatch.count)} divergências de NF</span>
          )}
          {statusUnvalidated && <span>Situação do produto não validada</span>}
          {!alerts.length && <span>Nenhum alerta</span>}
          {!nfMismatch && !statusUnvalidated && alerts.length > 0 && (
            <span>{formatCount(alerts.length)} tipos de alerta</span>
          )}
        </div>
      </div>
      {alerts.length > 0 && (
        <details>
          <summary>Ver detalhes ({formatCount(alerts.length)})</summary>
          <ul className={styles.qualityDetails}>
            {alerts.map((alert) => (
              <li key={alert.type}>
                <strong>
                  {formatCount(alert.count)} {ALERT_UNIT_LABELS[alert.unit]}
                </strong>{" "}
                · {alert.message}
              </li>
            ))}
          </ul>
          <small>Ocorrências por tipo; não somam pedidos únicos.</small>
        </details>
      )}
    </section>
  );
}

const TRACE_TITLES: Record<TraceSelection["metric"], string> = {
  toBill: "A faturar — linhas sem data de faturamento",
  portfolio: "Valor total da carteira",
  cif: "CIF",
  fob: "FOB",
  unknown: "Frete desconhecido",
  inMap: "Em mapa",
  outOfMap: "Fora de mapa",
  partialMap: "Valor dos pedidos parcialmente em mapa",
  state: "Valores por UF",
  city: "Valores por cidade",
};

function TraceDrawer({
  selection,
  metadata,
  onClose,
  onChanged,
}: {
  selection: TraceSelection;
  metadata: SnapshotMetadata;
  onClose: () => void;
  onChanged: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setErrorCode(null);

    const params = new URLSearchParams({
      metric: selection.metric,
      fingerprint: metadata.snapshotFingerprint ?? "",
      importId: metadata.activeImportId ?? "",
      page: String(page),
      pageSize: "25",
    });
    if (metadata.period) params.set("month", metadata.period.month);
    if (selection.key) params.set("key", selection.key);
    if (orderId) params.set("orderId", orderId);

    fetch(`/api/dashboard/expedition/details?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error?.code ?? "TRACE_UNAVAILABLE");
        }
        if (!controller.signal.aborted) {
          setDetail(json);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setErrorCode(err instanceof Error ? err.message : "TRACE_UNAVAILABLE");
        }
      });

    return () => controller.abort();
  }, [
    selection.metric,
    selection.key,
    metadata.snapshotFingerprint,
    metadata.activeImportId,
    metadata.period,
    page,
    orderId,
  ]);

  return (
    <dialog
      ref={dialogRef}
      className={styles.traceDrawer}
      aria-label="Detalhamento financeiro"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className={styles.root}>
        <header className={styles.heading}>
          <h2>
            {TRACE_TITLES[selection.metric]}
            {selection.key ? ` · ${selection.key}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhamento"
          >
            Fechar
          </button>
        </header>
        <p className={styles.metadata}>
          {metadata.filename} · Importação:{" "}
          {metadata.activeImportId ?? "legada"} · Valores operacionais, não
          faturamento.
        </p>
        {selection.metric === "partialMap" && (
          <p>
            Valor do pedido inteiro. Valor efetivamente alocado e restante não
            disponíveis: a fonte não comprova as parcelas.
          </p>
        )}
        {selection.metric === "toBill" && (
          <p>
            Somente Total Item das linhas sem data de faturamento. Itens já
            datados do mesmo pedido não entram. Nas baixas parciais, este valor
            não comprova o saldo financeiro restante.
          </p>
        )}
        {errorCode ? (
          <div role="alert">
            <p>
              {errorCode === "ACTIVE_WORKBOOK_CHANGED"
                ? "A carteira ativa mudou. Atualize os indicadores antes de continuar."
                : "Detalhamento indisponível. Verifique o acesso ou tente novamente."}
            </p>
            {errorCode === "ACTIVE_WORKBOOK_CHANGED" && (
              <button type="button" onClick={onChanged}>
                Atualizar carteira
              </button>
            )}
          </div>
        ) : detail ? (
          <>
            <p>
              <strong>{formatMoney(detail.total)}</strong> ·{" "}
              {formatCount(detail.totalOrders)} pedidos no indicador
            </p>
            {detail.order ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOrderId(null);
                    setPage(1);
                  }}
                >
                  Voltar aos pedidos
                </button>
                <h3>
                  Pedido {detail.order.orderId} ·{" "}
                  {formatMoney(detail.order.amount)}
                </h3>
                <p>
                  {detail.order.clients.join(" / ") || "Cliente não informado"} ·{" "}
                  {detail.order.city ?? "Cidade não informada"} /{" "}
                  {detail.order.uf ?? "UF não informada"} ·{" "}
                  {detail.order.freight} ·{" "}
                  {detail.order.map
                    ? CATEGORY_LABELS[detail.order.map]
                    : "Mapa desconhecido"}
                </p>
                <p>
                  {formatCount(detail.order.itemCount)} itens de origem. Linhas
                  repetidas permanecem identificadas por sua posição na fonte.
                </p>
                <ol className={styles.traceList}>
                  {detail.items.map((item: any) => {
                    const cents = item.amountCents;
                    return (
                      <li key={item.row}>
                        <strong>
                          Linha {item.row}:{" "}
                          {item.product ?? "Descrição do item não disponível"} ·{" "}
                          {formatMoney({
                            status: cents === null ? "UNKNOWN" : "AVAILABLE",
                            value: cents,
                            knownValue: cents,
                            unknownCount: cents === null ? 1 : 0,
                            reason: null,
                          })}
                        </strong>
                        <p>
                          {item.client ?? "Cliente não informado"} ·{" "}
                          {item.city ?? "Cidade não informada"} /{" "}
                          {item.uf ?? "UF não informada"} · {item.freight} ·{" "}
                          {item.mapped === null
                            ? "Mapa desconhecido"
                            : item.mapped
                              ? "Item em mapa"
                              : "Item fora de mapa"}
                        </p>
                        <small>
                          Situação operacional:{" "}
                          {item.operationalStatus || "não informada"} · Total
                          Item
                        </small>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <ol className={styles.traceList}>
                {detail.orders.map((ord: any) => (
                  <li key={ord.orderId}>
                    <button
                      type="button"
                      className={styles.traceOrder}
                      onClick={() => {
                        setOrderId(ord.orderId);
                        setPage(1);
                      }}
                    >
                      <strong>
                        Pedido {ord.orderId} · {formatMoney(ord.amount)}
                      </strong>
                      <span>
                        {ord.clients.join(" / ") || "Cliente não informado"} ·{" "}
                        {ord.city ?? "Cidade não informada"} /{" "}
                        {ord.uf ?? "UF não informada"}
                      </span>
                      <small>
                        {ord.freight} ·{" "}
                        {ord.map
                          ? CATEGORY_LABELS[ord.map]
                          : "Mapa desconhecido"}{" "}
                        · {formatCount(ord.itemCount)} itens · Ver itens
                      </small>
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {!detail.orders.length && !detail.order && (
              <p>Nenhum pedido neste recorte.</p>
            )}
            <nav
              className={styles.heading}
              aria-label="Paginação do detalhamento"
            >
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page} de {Math.max(1, detail.totalPages)}
              </span>
              <button
                type="button"
                disabled={page >= detail.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </nav>
          </>
        ) : (
          <p role="status">Carregando detalhes…</p>
        )}
      </div>
    </dialog>
  );
}

function getCurrentMonthSP() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return (
    <section className={styles.root} role="alert">
      <div className={styles.panel}>
        <h2>Não foi possível carregar os indicadores.</h2>
        <p>A aplicação continua disponível. Tente novamente.</p>
        <button type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      </div>
    </section>
  );
}

export function ExpeditionDashboardContent({
  snapshot,
  onImport,
  operation,
  error = false,
  onRetry = () => {},
}: {
  snapshot: ExpeditionSnapshot | null;
  onImport?: () => void;
  operation?: React.ReactNode;
  error?: boolean;
  onRetry?: () => void;
}) {
  const [traceSelection, setTraceSelection] = useState<TraceSelection | null>(
    null,
  );
  const importButton = (
    <button type="button" className={styles.primary} onClick={onImport}>
      Importar planilha
    </button>
  );

  if (error) {
    return (
      <div className={styles.root}>
        <ErrorPanel onRetry={onRetry} />
        <div key="operation">{operation}</div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className={styles.root}>
        <section
          aria-busy="true"
          aria-label="Carregando Central de Expedição"
        >
          <h2>Central de Expedição</h2>
          <div className={styles.cards}>
            {Array.from({ length: 4 }, (_, idx) => (
              <div key={idx} className={styles.skeleton} />
            ))}
          </div>
          <span role="status">Carregando indicadores…</span>
        </section>
        <div key="operation">{operation}</div>
      </div>
    );
  }

  if (snapshot.snapshotStatus === "EMPTY" && snapshot.metadata.period) {
    return (
      <div className={styles.root}>
        <section className={styles.panel}>
          <h2>Nenhum registro datado no mês selecionado.</h2>
          <p>
            Período: {snapshot.metadata.period.month} · Data/Hora Faturamento ·
            Filial 281. A planilha ativa foi preservada; selecione outro mês.
          </p>
        </section>
        <div key="operation">{operation}</div>
      </div>
    );
  }

  if (
    snapshot.snapshotStatus === "NO_WORKBOOK" ||
    snapshot.snapshotStatus === "EMPTY"
  ) {
    return (
      <div className={styles.root}>
        <div className={styles.panel}>
          <h2>
            Nenhuma carteira{" "}
            {snapshot.snapshotStatus === "EMPTY"
              ? "com pedidos válidos"
              : "importada"}
            .
          </h2>
          <p>Importe uma planilha para visualizar os indicadores da carteira.</p>
          <button type="button" className={styles.primary} onClick={onImport}>
            Importar primeira planilha
          </button>
        </div>
        <div key="operation">{operation}</div>
      </div>
    );
  }

  if (snapshot.snapshotStatus === "SOURCE_UNAVAILABLE") {
    return (
      <div className={styles.root}>
        <div className={styles.panel}>
          <h2>Fonte da carteira indisponível</h2>
          <p>Não há dados suficientes para validar os indicadores.</p>
          {importButton}
        </div>
        <div key="operation">{operation}</div>
      </div>
    );
  }

  const minCapStage = snapshot.eligibilityFunnel.find(
    (s) => s.id === "MINIMUM_CAPACITY",
  );
  const importedAtStr = snapshot.metadata.importedAt;
  const formattedImportDate =
    importedAtStr && Number.isFinite(Date.parse(importedAtStr))
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(importedAtStr))
      : "Data não disponível";

  return (
    <div className={styles.root}>
      <header className={styles.heading}>
        <div>
          <h2 className={styles.title}>Central de Expedição</h2>
          <p className={styles.metadata}>
            {snapshot.metadata.period
              ? `Período: ${snapshot.metadata.period.month} · Data/Hora Faturamento · Filial 281`
              : `Competência: ${snapshot.metadata.competence ?? "não informada"}`}{" "}
            · {formatCount(snapshot.metadata.orderCount)} pedidos
          </p>
          <p className={styles.metadata}>
            {snapshot.metadata.filename ?? "Arquivo não informado"} · Upload:{" "}
            {formattedImportDate}
          </p>
        </div>
        {importButton}
      </header>

      <div
        className={styles.analytics}
        aria-label="Gráficos da carteira completa"
      >
        <StateDistributionChart
          groups={snapshot.byState}
          cities={snapshot.byCity}
          onDetail={setTraceSelection}
        />
        <CifFobChart
          rows={snapshot.freightBreakdown}
          onDetail={setTraceSelection}
        />
        <MapStatusChart
          rows={snapshot.mapBreakdown}
          unknownMapCount={snapshot.unknownMapCount}
          onDetail={setTraceSelection}
        />
      </div>

      <div
        className={styles.cards}
        aria-label="Indicadores principais da carteira"
      >
        <KpiCard title="Faturamento" card={snapshot.cards.billing} billing />
        <KpiCard
          title="Pedidos da carteira"
          card={snapshot.cards.portfolio}
          onDetail={() => setTraceSelection({ metric: "portfolio" })}
        />
        <KpiCard
          title="Em mapa"
          card={snapshot.cards.inMap}
          tone="positive"
          onDetail={() => setTraceSelection({ metric: "inMap" })}
        />
        <KpiCard
          title="Elegíveis após pré-checks"
          card={{
            status: minCapStage?.status ?? "UNKNOWN",
            count: minCapStage?.outputCount ?? null,
            amount: minCapStage?.amount ?? snapshot.cards.routeEligible.amount,
            percentageOfOrders: minCapStage?.percentageOfTotal ?? null,
            reason: null,
          }}
        />
      </div>

      <SecondaryMetrics
        cards={
          snapshot.metadata.period
            ? { ...snapshot.cards, toBill: undefined }
            : snapshot.cards
        }
        freight={snapshot.freightBreakdown}
        onDetail={(metric) => setTraceSelection({ metric })}
      />

      {snapshot.metadata.period && (
        <p className={styles.metadata}>
          Valores dos registros datados do mês; não equivalem a faturamento
          oficial comprovado. Linhas sem data (“a faturar”) ficam fora deste
          recorte.
        </p>
      )}

      <div key="operation">{operation}</div>

      <EligibilityFunnel stages={snapshot.eligibilityFunnel} />
      <DataQualitySection alerts={snapshot.dataQuality} />

      {traceSelection && (
        <TraceDrawer
          key={`${snapshot.metadata.activeImportId}:${snapshot.metadata.snapshotFingerprint}:${traceSelection.metric}:${traceSelection.key ?? ""}`}
          selection={traceSelection}
          metadata={snapshot.metadata}
          onClose={() => setTraceSelection(null)}
          onChanged={() => {
            setTraceSelection(null);
            onRetry();
          }}
        />
      )}
    </div>
  );
}

export function ExpeditionDashboard({
  onImport,
  operation,
}: {
  onImport?: () => void;
  operation?: React.ReactNode;
}) {
  const [snapshot, setSnapshot] = useState<ExpeditionSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [month, setMonth] = useState(getCurrentMonthSP);

  useEffect(() => onWorkbookConfirmed(() => setReloadNonce((n) => n + 1)), []);

  const fetchStartRef = useRef(0);
  const renderStartRef = useRef(0);
  const requestCountRef = useRef(0);
  const [perfMetrics, setPerfMetrics] = useState<{
    load: number;
    render: number;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchStartRef.current = performance.now();
    requestCountRef.current += 1;
    setError(false);
    setSnapshot(null);

    fetch(`/api/dashboard/expedition?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("dashboard");
        const data = await res.json();
        if (!controller.signal.aborted) {
          renderStartRef.current = performance.now();
          setSnapshot(data);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError(true);
        }
      });

    return () => controller.abort();
  }, [reloadNonce, month]);

  useEffect(() => {
    if (!snapshot) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setPerfMetrics({
          load: Math.round(performance.now() - fetchStartRef.current),
          render: Math.round(performance.now() - renderStartRef.current),
        });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [snapshot]);

  return (
    <div
      data-dashboard-load-ms={perfMetrics?.load}
      data-dashboard-render-ms={perfMetrics?.render}
      data-dashboard-requests={requestCountRef.current}
    >
      <div className={styles.periodToolbar}>
        <label className={styles.periodField}>
          <span>Mês de referência</span>
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) {
                setMonth(e.target.value);
              }
            }}
          />
        </label>
        <p>
          Data/Hora Faturamento <span>· Filial 281</span>
        </p>
      </div>
      <ExpeditionDashboardContent
        snapshot={snapshot}
        error={error}
        onRetry={() => setReloadNonce((n) => n + 1)}
        onImport={onImport}
        operation={operation}
      />
    </div>
  );
}

export function CurrentOperationSection({
  routes,
  onSelectRoute,
  onOpenTab,
}: {
  routes: (ActiveRoutePoint & { driver_id?: string | null })[];
  onSelectRoute: (routeId: string) => void;
  onOpenTab?: (tab: string) => void;
}) {
  const operationalRoutes = routes.filter(
    (r) => r.status === "active" || r.status === "assigned",
  );
  const activeRoutes = operationalRoutes.filter((r) => r.status === "active");
  const activeDriversCount = activeRoutes.every((r) => r.driver_id)
    ? new Set(activeRoutes.map((r) => r.driver_id)).size
    : null;

  return (
    <section
      className={`${styles.root} ${styles.operation}`}
      aria-labelledby="current-operation-heading"
    >
      <header>
        <p className={styles.eyebrow}>AGORA · OPERAÇÃO ATUAL</p>
        <h2 id="current-operation-heading">Mapa e rotas em operação</h2>
        <p className={styles.operationNote}>
          Últimas posições recebidas. O envio depende da página do motorista
          ativa e pode pausar em segundo plano.
        </p>
      </header>
      <div className={styles.operationGrid}>
        <div className={styles.operationMap}>
          <LiveFleetMap
            routes={operationalRoutes}
            onSelectRoute={onSelectRoute}
          />
          {!activeRoutes.length && (
            <p className={styles.operationNote}>
              Nenhuma rota em andamento no momento.
            </p>
          )}
        </div>
        <aside className={styles.panel} aria-label="Resumo da operação atual">
          <h3>Operação agora</h3>
          <dl className={styles.operationStats}>
            <div>
              <dt>Rotas em andamento</dt>
              <dd>{formatCount(activeRoutes.length)}</dd>
            </div>
            <div>
              <dt>Motoristas em rota</dt>
              <dd>{formatCount(activeDriversCount)}</dd>
            </div>
            <div>
              <dt>Rotas atribuídas</dt>
              <dd>
                {formatCount(operationalRoutes.length - activeRoutes.length)}
              </dd>
            </div>
          </dl>
          <div className={styles.operationalRoutes}>
            {operationalRoutes.slice(0, 4).map((r) => (
              <article key={r.id}>
                <strong>{r.name}</strong>
                <small>{r.driver_name || "Motorista não informado"}</small>
                <small>
                  {[r.vehicle_name, r.plate].filter(Boolean).join(" · ") ||
                    "Veículo não informado"}
                </small>
                <p>
                  {r.status === "active" ? "Em rota" : "Atribuída"} ·{" "}
                  {formatCount(r.delivered)}/{formatCount(r.deliveries)} entregas
                </p>
                <small>
                  {r.last_location
                    ? `Última posição: ${formatLastPositionTime(r.last_location.recorded_at)}`
                    : "Sem posição recebida"}
                </small>
                <button
                  type="button"
                  onClick={() => onSelectRoute(r.id)}
                  aria-label={`Ver rota ${r.name}`}
                >
                  Ver rota
                </button>
              </article>
            ))}
            {!operationalRoutes.length && (
              <p>Nenhuma rota ativa ou atribuída.</p>
            )}
          </div>
          {operationalRoutes.length > 4 && (
            <small>
              {formatCount(operationalRoutes.length - 4)} outras rotas no painel
              de rotas.
            </small>
          )}
          <div className={styles.filters}>
            <button type="button" onClick={() => onOpenTab?.("routes")}>
              Todas as rotas
            </button>
            <button type="button" onClick={() => onOpenTab?.("people")}>
              Motoristas
            </button>
            <button type="button" onClick={() => onOpenTab?.("vehicles")}>
              Veículos
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
