"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Gauge,
  MapPin,
  Printer,
  Truck,
  UserRound,
  X,
} from "lucide-react";

export type DetailedRoute = {
  id: string;
  public_id: string;
  name: string;
  route_date: string;
  status: string;
  driver_id?: string;
  driver_name?: string;
  vehicle_name?: string;
  plate?: string;
  deliveries: number;
  delivered: number;
  estimated_km?: number;
  actual_km?: number;
  started_at?: string;
  finished_at?: string;
  cancelled_at?: string;
  stops?: Array<{
    id: string;
    position: number;
    name: string;
    address: string;
    lat: number;
    lng: number;
    is_origin: boolean;
    status: "pending" | "delivered";
    delivered_at?: string;
    boxes?: number;
    volume_m3?: number;
  }>;
  odometer?: Array<{
    phase: "start" | "finish";
    kilometers: number;
    photo_key: string;
    photo_url?: string;
    lat?: number;
    lng?: number;
    recorded_at: string;
  }>;
  delivery_events?: Array<{
    id: string;
    stop_id: string;
    photo_key: string;
    photo_url?: string;
    note?: string;
    lat: number;
    lng: number;
    delivered_at: string;
    stop_name?: string;
    stop_position?: number;
    stop_address?: string;
  }>;
  location_points?: Array<{
    lat: number;
    lng: number;
    recorded_at: string;
    accuracy?: number;
  }>;
};

export function RouteDetailModal({
  routeId,
  onClose,
  onPrintReport,
}: {
  routeId: string;
  onClose: () => void;
  onPrintReport?: (route: DetailedRoute) => void;
}) {
  const [route, setRoute] = useState<DetailedRoute | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePhoto, setActivePhoto] = useState<{
    url: string;
    title: string;
    subtitle?: string;
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    const role = typeof window !== "undefined" ? sessionStorage.getItem("rw_role") : null;
    fetch(`/api/routes/${routeId}`, {
      headers: role ? { "X-RouteWise-Role": role } : {},
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erro ao carregar detalhes");
        setRoute(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [routeId]);

  if (loading) {
    return (
      <div className="modal-backdrop">
        <div className="modal wide">
          <div className="modal-loading">
            <div className="spinner" />
            <p>Carregando informações da rota…</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <header>
            <h2>Erro</h2>
            <button onClick={onClose}><X size={18} /></button>
          </header>
          <div className="form-grid">
            <p className="form-error">{error || "Rota não encontrada"}</p>
            <button className="button secondary" onClick={onClose}>Fechar</button>
          </div>
        </div>
      </div>
    );
  }

  const startOdo = route.odometer?.find((o) => o.phase === "start");
  const finishOdo = route.odometer?.find((o) => o.phase === "finish");

  const deliveryStops = route.stops?.filter((s) => !s.is_origin && (s.position === undefined || s.position > 0)) || [];
  const completedStops = deliveryStops.filter((s) => s.status === "delivered");
  const totalDeliveries = deliveryStops.length > 0 ? deliveryStops.length : Number(route.deliveries || 0);
  const deliveredCount = deliveryStops.length > 0 ? completedStops.length : Number(route.delivered || 0);

  const formatTime = (ts?: string) => {
    if (!ts) return "--:--";
    return new Date(ts).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "--/--/----";
    const clean = String(dateStr).slice(0, 10);
    const parts = clean.split("-");
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide detail-modal-shell" onClick={(e) => e.stopPropagation()}>
        <header className="detail-modal-header">
          <div>
            <div className="detail-header-badges">
              <span className={`status ${route.status}`}>{route.status}</span>
              <span><Calendar size={13} /> {formatDate(route.route_date)}</span>
            </div>
            <h2>{route.name}</h2>
            <p className="detail-subtitle">
              Motorista: <b>{route.driver_name || "Não atribuído"}</b> · Veículo: <b>{route.vehicle_name || "--"} ({route.plate || "--"})</b>
            </p>
          </div>
          <div className="detail-header-actions">
            {route.status === "completed" && onPrintReport && (
              <button
                type="button"
                className="button secondary compact"
                onClick={() => onPrintReport(route)}
                title="Imprimir romaneio completo"
              >
                <Printer size={15} /> Imprimir Romaneio
              </button>
            )}
            <button onClick={onClose} title="Fechar"><X size={18} /></button>
          </div>
        </header>

        <div className="detail-modal-body">
          {/* Summary metrics strip */}
          <div className="detail-metrics-grid">
            <div className="detail-metric-card">
              <Truck size={18} className="metric-icon" />
              <div>
                <small>Veículo</small>
                <strong>{route.plate || route.vehicle_name || "Não definido"}</strong>
              </div>
            </div>
            <div className="detail-metric-card">
              <MapPin size={18} className="metric-icon" />
              <div>
                <small>Entregas</small>
                <strong>{deliveredCount}/{totalDeliveries}</strong>
              </div>
            </div>
            <div className="detail-metric-card">
              <Gauge size={18} className="metric-icon" />
              <div>
                <small>Quilometragem</small>
                <strong>
                  {route.actual_km !== null && route.actual_km !== undefined
                    ? `${Number(route.actual_km).toFixed(1)} km real`
                    : route.estimated_km
                      ? `${Number(route.estimated_km).toFixed(1)} km est.`
                      : "-- km"}
                </strong>
              </div>
            </div>
          </div>

          {/* Odometer Section */}
          <section className="detail-section">
            <div className="section-title">
              <Gauge size={16} />
              <h3>Vistoria e Odômetro</h3>
            </div>
            <div className="odometer-cards-grid">
              <div className="odometer-card">
                <div className="odo-badge start">Saída</div>
                <div className="odo-info">
                  <strong>{startOdo ? `${startOdo.kilometers} km` : "Não registrado"}</strong>
                  <small>{startOdo ? `Registrado às ${formatTime(startOdo.recorded_at)}` : "Pendente"}</small>
                </div>
                {startOdo?.photo_url && (
                  <button
                    type="button"
                    className="odo-photo-thumb"
                    onClick={() =>
                      setActivePhoto({
                        url: startOdo.photo_url!,
                        title: "Foto do Odômetro — Saída",
                        subtitle: `${startOdo.kilometers} km às ${formatTime(startOdo.recorded_at)}`,
                      })
                    }
                  >
                    <img src={startOdo.photo_url} alt="Odômetro Saída" />
                    <span><Camera size={12} /> Ver foto</span>
                  </button>
                )}
              </div>

              <div className="odometer-card">
                <div className="odo-badge finish">Retorno</div>
                <div className="odo-info">
                  <strong>{finishOdo ? `${finishOdo.kilometers} km` : "Não registrado"}</strong>
                  <small>{finishOdo ? `Registrado às ${formatTime(finishOdo.recorded_at)}` : "Pendente"}</small>
                </div>
                {finishOdo?.photo_url && (
                  <button
                    type="button"
                    className="odo-photo-thumb"
                    onClick={() =>
                      setActivePhoto({
                        url: finishOdo.photo_url!,
                        title: "Foto do Odômetro — Retorno",
                        subtitle: `${finishOdo.kilometers} km às ${formatTime(finishOdo.recorded_at)}`,
                      })
                    }
                  >
                    <img src={finishOdo.photo_url} alt="Odômetro Retorno" />
                    <span><Camera size={12} /> Ver foto</span>
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Stops List */}
          <section className="detail-section">
            <div className="section-title">
              <MapPin size={16} />
              <h3>Paradas e Comprovantes de Entrega ({route.stops?.length || 0})</h3>
            </div>

            <div className="detail-stops-list">
              {route.stops?.map((stop, index) => {
                const isOrigin = stop.is_origin || index === 0;
                const isDelivered = stop.status === "delivered";
                const event = route.delivery_events?.find((e) => e.stop_id === stop.id);

                return (
                  <div key={stop.id || index} className={`detail-stop-row ${isDelivered ? "delivered" : ""}`}>
                    <div className={`stop-indicator ${isOrigin ? "origin" : isDelivered ? "delivered" : ""}`}>
                      {isOrigin ? "A" : isDelivered ? <Check size={14} /> : index}
                    </div>

                    <div className="stop-info">
                      <div className="stop-head">
                        <b>{stop.name}</b>
                        <span className={`stop-status-pill ${isOrigin ? "origin" : stop.status}`}>
                          {isOrigin ? "Origem" : isDelivered ? "Entregue" : "Pendente"}
                        </span>
                      </div>
                      <p className="stop-address">{stop.address}</p>
                      {((stop.boxes !== undefined && stop.boxes > 0) || (stop.volume_m3 !== undefined && stop.volume_m3 > 0)) && (
                        <div className="stop-detail-cubagem-tag">
                          {stop.boxes !== undefined && stop.boxes > 0 && <span>📦 {stop.boxes} {stop.boxes === 1 ? "cx" : "cxs"}</span>}
                          {stop.volume_m3 !== undefined && stop.volume_m3 > 0 && <span>📐 {stop.volume_m3} m³</span>}
                        </div>
                      )}

                      {!isOrigin && (
                        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                          <button
                            type="button"
                            className="button secondary compact"
                            style={{ fontSize: 11, padding: "3px 8px" }}
                            onClick={() => {
                              fetch("/api/ssw/rastreio", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ invoiceNumber: stop.name }),
                              })
                                .then((r) => r.json())
                                .then((data) => {
                                  alert(`📦 Rastreamento SSW — ${stop.name}\nStatus: ${data.status}\nÚltima atualização: ${data.occurrences?.[2]?.occurrenceName || "Em Rota"} (${data.occurrences?.[2]?.city || "Filial"})`);
                                })
                                .catch(() => alert("Não foi possível consultar o SSW no momento."));
                            }}
                          >
                            <ExternalLink size={12} /> Rastreio SSW
                          </button>
                        </div>
                      )}

                      {isDelivered && (
                        <div className="delivery-proof-meta">
                          <span className="delivery-time">
                            <Clock size={12} /> {formatTime(stop.delivered_at || event?.delivered_at)}
                          </span>
                          {event?.note && (
                            <span className="delivery-note">
                              💬 &ldquo;{event.note}&rdquo;
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {event?.photo_url && (
                      <button
                        type="button"
                        className="stop-proof-thumb"
                        onClick={() =>
                          setActivePhoto({
                            url: event.photo_url!,
                            title: `Comprovante: ${stop.name}`,
                            subtitle: `${formatTime(event.delivered_at)}${event.note ? ` · "${event.note}"` : ""}`,
                          })
                        }
                      >
                        <img src={event.photo_url} alt="Comprovante" />
                        <span><Camera size={11} /> Foto</span>
                      </button>
                    )}
                  </div>
                );
              })}

              {(!route.stops || route.stops.length === 0) && (
                <p className="empty-notice">Nenhuma parada cadastrada nesta rota.</p>
              )}
            </div>
          </section>
        </div>

        <footer className="route-detail-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Fechar
          </button>
          {onPrintReport && (
            <button
              type="button"
              className="button primary"
              onClick={() => onPrintReport(route)}
            >
              <Printer size={16} /> Imprimir romaneio completo
            </button>
          )}
        </footer>
      </div>

      {/* Lightbox Modal */}
      {activePhoto && (
        <div className="photo-lightbox-backdrop" onClick={() => setActivePhoto(null)}>
          <div className="photo-lightbox" onClick={(e) => e.stopPropagation()}>
            <header className="lightbox-header">
              <div>
                <h4>{activePhoto.title}</h4>
                {activePhoto.subtitle && <small>{activePhoto.subtitle}</small>}
              </div>
              <button type="button" onClick={() => setActivePhoto(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="lightbox-img-wrap">
              <img src={activePhoto.url} alt={activePhoto.title} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
