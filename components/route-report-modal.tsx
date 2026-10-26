"use client";
import { useEffect, useState } from "react";
import { ExternalLink, FileSpreadsheet, Navigation, Printer, Share2, X } from "lucide-react";
import type { DetailedRoute } from "./route-detail-modal";
import { printElement } from "@/lib/print-document";

export function RouteReportModal({
  route,
  onClose,
}: {
  route: DetailedRoute;
  onClose: () => void;
}) {
  const startOdo = route.odometer?.find((o) => o.phase === "start");
  const finishOdo = route.odometer?.find((o) => o.phase === "finish");

  const deliveryStops = route.stops?.filter((s) => !s.is_origin && (s.position === undefined || s.position > 0)) || [];
  const completedStops = deliveryStops.filter((s) => s.status === "delivered");
  const totalDeliveries = Number(route.deliveries || deliveryStops.length || 0);
  const deliveredCount = Number(route.delivered || completedStops.length || 0);
  const successRate = totalDeliveries > 0 ? `${Math.round((deliveredCount / totalDeliveries) * 100)}%` : "--";

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const clean = String(dateStr).slice(0, 10);
    const [y, m, d] = clean.split("-");
    if (!y || !m || !d) return dateStr;
    return `${d}/${m}/${y}`;
  };

  const formatTime = (ts?: string) => {
    if (!ts) return "--:--";
    return new Date(ts).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const calculateDuration = () => {
    const start = route.started_at || startOdo?.recorded_at;
    const finish = route.finished_at || finishOdo?.recorded_at;
    if (!start || !finish) return null;
    const diffMs = new Date(finish).getTime() - new Date(start).getTime();
    if (diffMs <= 0) return null;
    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return hours > 0 ? `${hours}h ${remainingMinutes}min` : `${minutes} min`;
  };

  const duration = calculateDuration();
  const [emissionDate, setEmissionDate] = useState<string>("");
  useEffect(() => {
    setEmissionDate(`${new Date().toLocaleDateString("pt-BR")} às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
  }, []);
  const mapStops = route.stops?.filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng))) || [];
  const googleMapsUrl = mapStops.length > 1
    ? `https://www.google.com/maps/dir/${mapStops.map((stop) => `${stop.lat},${stop.lng}`).join("/")}`
    : null;

  const [isIosStandalone, setIsIosStandalone] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isStandalone =
        (window.navigator as unknown as { standalone?: boolean })?.standalone === true ||
        Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches);
      const ua = (navigator.userAgent || "").toLowerCase();
      const isIos =
        /iphone|ipad|ipod/.test(ua) ||
        (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
      setIsIosStandalone(Boolean(isStandalone && isIos));
    }
  }, []);

  const printDocument = () =>
    printElement("printable-report", `Relatório - ${route.name}`, {
      routeId: route.id,
    }).catch((error) => window.alert(error.message));

  const handleShare = async () => {
    let shareUrl = `${window.location.origin}/imprimir-romaneio?routeId=${encodeURIComponent(route.id)}`;
    try {
      const source = document.getElementById("printable-report");
      if (source) {
        const res = await fetch("/api/print", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html: source.outerHTML,
            title: `Relatório - ${route.name}`,
            routeId: route.id,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.token) {
            shareUrl = `${window.location.origin}/imprimir-romaneio?token=${encodeURIComponent(data.token)}`;
          }
        }
      }
    } catch {}

    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `Romaneio - ${route.name}`,
          text: `Romaneio da Rota: ${route.name} (${route.driver_name || "Motorista"}) - ${completedStops.length}/${deliveryStops.length} entregas concluídas.`,
          url: shareUrl,
        });
      } catch {}
    } else {
      printDocument();
    }
  };

  return (
    <div className="modal-backdrop report-backdrop" onClick={onClose}>
      <div className="report-modal-shell" onClick={(e) => e.stopPropagation()}>
        {/* Floating Toolbar - hidden when printing */}
        <div className="report-floating-toolbar no-print">
          <div className="toolbar-info">
            <b>Relatório de Rota (Romaneio)</b>
            <small>Pronto para impressão ou exportação em PDF / Excel</small>
          </div>
          <div className="toolbar-buttons">
            <button type="button" className="button secondary compact" onClick={onClose}>
              <X size={15} /> Fechar
            </button>
            <a className="button secondary compact" href="/api/reports/export?format=xlsx" download>
              <FileSpreadsheet size={15} /> Baixar Excel (.xlsx)
            </a>
            {isIosStandalone && (
              <a
                className="button secondary compact"
                href={`x-safari-${typeof window !== "undefined" ? window.location.origin : ""}/imprimir-romaneio?routeId=${encodeURIComponent(route.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Abrir no Safari para acionar AirPrint nativo"
              >
                <ExternalLink size={15} /> Abrir no Safari
              </a>
            )}
            <button type="button" className="button secondary compact" onClick={handleShare}>
              <Share2 size={15} /> Compartilhar
            </button>
            <button type="button" className="button primary compact" onClick={printDocument}>
              <Printer size={15} /> Imprimir / Salvar PDF
            </button>
            {googleMapsUrl && <a className="button secondary compact" href={googleMapsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Google Maps</a>}
          </div>
        </div>

        {/* Printable Document Paper */}
        <div className="printable-report-paper" id="printable-report">
          {/* Header */}
          <header className="report-doc-header">
            <div className="report-logo">
              <img className="brand-mark" src="/icon.svg" width={40} height={40} alt="" aria-hidden="true" />
              <b>Criar Rota</b>
            </div>
            <div className="report-title-block">
              <h1>ROMANEIO DE ENTREGA & PRESTAÇÃO DE CONTAS</h1>
              <p>Comprovante operacional de viagem e entregas</p>
            </div>
            <div className="report-meta-box">
              <span>Data de emissão</span>
              <strong suppressHydrationWarning>{emissionDate || "—"}</strong>
            </div>
          </header>

          {/* Operation info grid */}
          <section className="report-section">
            <h2 className="report-section-title">1. Informações Gerais da Operação</h2>
            <div className="report-grid-3">
              <div className="report-field">
                <label>Nome da Rota</label>
                <div>{route.name}</div>
              </div>
              <div className="report-field">
                <label>Data da Rota</label>
                <div>{formatDate(route.route_date)}</div>
              </div>
              <div className="report-field">
                <label>Situação</label>
                <div className="report-status">{route.status.toUpperCase()}</div>
              </div>
              <div className="report-field">
                <label>Motorista Responsável</label>
                <div>{route.driver_name || "Não informado"}</div>
              </div>
              <div className="report-field">
                <label>Veículo Utilizado</label>
                <div>{route.vehicle_name || "Não informado"}</div>
              </div>
              <div className="report-field">
                <label>Placa do Veículo</label>
                <div className="report-plate">{route.plate || "--"}</div>
              </div>
            </div>
          </section>

          {/* Odometer & Times */}
          <section className="report-section">
            <h2 className="report-section-title">2. Controle de Quilometragem e Horários</h2>
            <table className="report-table-summary">
              <thead>
                <tr>
                  <th>Fase</th>
                  <th>Odômetro Registrado</th>
                  <th>Horário Registrado</th>
                  <th>Foto do Painel</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Saída</b></td>
                  <td>{startOdo ? `${Number(startOdo.kilometers).toFixed(1)} km` : "Não registrado"}</td>
                  <td>{startOdo ? formatTime(startOdo.recorded_at) : "--:--"}</td>
                  <td>{startOdo?.photo_key ? "✓ Anexada e validada" : "Pendente"}</td>
                </tr>
                <tr>
                  <td><b>Retorno</b></td>
                  <td>{finishOdo ? `${Number(finishOdo.kilometers).toFixed(1)} km` : "Não registrado"}</td>
                  <td>{finishOdo ? formatTime(finishOdo.recorded_at) : "--:--"}</td>
                  <td>{finishOdo?.photo_key ? "✓ Anexada e validada" : "Pendente"}</td>
                </tr>
              </tbody>
            </table>

            <div className="report-km-metrics">
              <div className="km-pill">
                <span>Km Real Percorrido:</span>
                <b>{route.actual_km !== null && route.actual_km !== undefined ? `${Number(route.actual_km).toFixed(1)} km` : "--"}</b>
              </div>
              <div className="km-pill">
                <span>Km Estimado Inicial:</span>
                <b>{route.estimated_km ? `${Number(route.estimated_km).toFixed(1)} km` : "--"}</b>
              </div>
              <div className="km-pill">
                <span>Duração Total:</span>
                <b>{duration || "--"}</b>
              </div>
              <div className="km-pill">
                <span>Taxa de Sucesso:</span>
                <b>{successRate} ({deliveredCount}/{totalDeliveries} entregas)</b>
              </div>
            </div>
          </section>

          {/* Stops List */}
          <section className="report-section">
            <h2 className="report-section-title">3. Paradas e Rastreamento de Entregas</h2>
            <table className="report-table-stops">
              <thead>
                <tr>
                  <th style={{ width: "40px" }}>#</th>
                  <th>Tipo</th>
                  <th>Nome do Local / Cliente</th>
                  <th>Endereço</th>
                  <th>Pedidos</th>
                  <th style={{ width: "80px" }}>Situação</th>
                  <th style={{ width: "70px" }}>Horário</th>
                  <th>Observação / Comprovante</th>
                </tr>
              </thead>
              <tbody>
                {route.stops?.map((stop, i) => {
                  const isOrigin = stop.is_origin || i === 0;
                  const isDelivered = stop.status === "delivered";
                  const stopEvents = route.delivery_events?.filter((e) => e.stop_id === stop.id) || [];
                  const event = stopEvents[0];

                  return (
                    <tr key={stop.id || i} className={isDelivered ? "row-delivered" : ""}>
                      <td style={{ textAlign: "center" }}><b>{isOrigin ? "A" : i}</b></td>
                      <td>{isOrigin ? "Origem" : "Entrega"}</td>
                      <td><b>{stop.name}</b></td>
                      <td className="addr-cell">{stop.address}</td>
                      <td>{stop.order_ids?.length ? stop.order_ids.join(", ") : "--"}</td>
                      <td>
                        <span className={`report-status-badge ${isOrigin ? "origin" : isDelivered ? "delivered" : "pending"}`}>
                          {isOrigin ? "Saída" : isDelivered ? "Entregue" : "Pendente"}
                        </span>
                        {event?.occurrence && event.occurrence !== "entregue" && <small> · {event.occurrence.replaceAll("_", " ")}</small>}
                      </td>
                      <td>{formatTime(stop.delivered_at || event?.delivered_at)}</td>
                      <td>
                        {stopEvents.map((evt) => evt.note).filter(Boolean).length > 0 && (
                          <span className="report-note-text">
                            &ldquo;{stopEvents.map((evt) => evt.note).filter(Boolean).join(" | ")}&rdquo;{" "}
                          </span>
                        )}
                        {stopEvents.length > 0 && (
                          <span className="report-photo-badge">
                            📷 {stopEvents.length > 1 ? `${stopEvents.length} Fotos` : "Foto"}
                          </span>
                        )}
                        {stopEvents.length === 0 && !event?.note && "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Signatures */}
          <section className="report-signatures-section">
            <div className="signature-box">
              <div className="sig-line" />
              <b>{route.driver_name || "Motorista"}</b>
              <small>Assinatura do Motorista Responsável</small>
            </div>
            <div className="signature-box">
              <div className="sig-line" />
              <b>Conferente / Organizador</b>
              <small>Visto e aprovação da prestação de contas</small>
            </div>
          </section>

          {/* Footer note */}
          <footer className="report-doc-footer">
            <small>Arquivo Administrativo & Auditoria · Criar Rota · Gerado em {new Date().toLocaleDateString("pt-BR")}</small>
          </footer>
        </div>
      </div>
    </div>
  );
}
