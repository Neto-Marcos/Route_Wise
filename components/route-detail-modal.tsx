"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Gauge,
  MapPin,
  Navigation,
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
    order_ids?: string[] | null;
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
    occurrence?: string;
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

function SavedRouteMap({
  stops,
  selectedStopId,
  onSelectStop,
}: {
  stops: NonNullable<DetailedRoute["stops"]>;
  selectedStopId: string | null;
  onSelectStop: (stopId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const validStops = stops.filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)));
      if (!validStops.length || !containerRef.current) return;
      const L = (await import("leaflet")).default;
      if (!mounted || !containerRef.current) return;
      mapRef.current?.remove();
      const points = validStops.map((stop) => [Number(stop.lat), Number(stop.lng)] as [number, number]);
      const selected = validStops.find((stop) => stop.id === selectedStopId);
      const map = L.map(containerRef.current, { zoomControl: true });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
      if (selected) map.setView([Number(selected.lat), Number(selected.lng)], 11);
      else map.fitBounds(L.latLngBounds(points).pad(0.18));
      L.polyline(points, { color: "#2563eb", weight: 4, opacity: 0.75 }).addTo(map);
      validStops.forEach((stop, index) => {
        const active = stop.id === selectedStopId;
        const marker = L.circleMarker([Number(stop.lat), Number(stop.lng)], {
          radius: active ? 12 : 8,
          color: active ? "#f59e0b" : stop.is_origin ? "#10b981" : "#2563eb",
          fillColor: active ? "#f59e0b" : stop.is_origin ? "#10b981" : "#2563eb",
          fillOpacity: 0.95,
          weight: 3,
        }).addTo(map);
        marker.bindTooltip(stop.is_origin ? "Origem" : `${index}ª parada · ${stop.name}`, { direction: "top" });
        marker.on("click", () => onSelectStop(stop.id));
      });
    })();
    return () => { mounted = false; mapRef.current?.remove(); mapRef.current = null; };
  }, [stops, selectedStopId, onSelectStop]);

  if (!stops.some((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng)))) return null;
  return <div ref={containerRef} style={{ height: 300, borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)", marginTop: 10 }} />;
}

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
  const [editingStop, setEditingStop] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);

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

  const removeStop = async (stopId: string, city: string) => {
    if (!route || !["draft", "assigned"].includes(route.status)) return;
    if (!window.confirm(`Remover ${city} desta rota antes do carregamento?`)) return;
    setEditingStop(stopId);
    try {
      const response = await fetch(`/api/routes/${routeId}/dynamic-stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", stopId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível remover a cidade.");
      setRoute((current) => current ? { ...current, stops: current.stops?.filter(stop => stop.id !== stopId) } : current);
    } catch (e) { setError((e as Error).message); }
    finally { setEditingStop(null); }
  };

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
  const mapStops = route.stops?.filter((stop) => Number.isFinite(Number(stop.lat)) && Number.isFinite(Number(stop.lng))) || [];
  const googleMapsUrl = mapStops.length > 1
    ? `https://www.google.com/maps/dir/${mapStops.map((stop) => `${stop.lat},${stop.lng}`).join("/")}`
    : null;

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
            {googleMapsUrl && (
              <a className="button secondary compact" href={googleMapsUrl} target="_blank" rel="noopener noreferrer" title="Abrir rota pronta no Google Maps">
                <Navigation size={15} /> Google Maps
              </a>
            )}
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

          <section className="detail-section">
            <div className="section-title">
              <MapPin size={16} />
              <h3>Mapa da rota salva</h3>
            </div>
            <p className="detail-subtitle" style={{ margin: "0 0 8px" }}>Clique em uma parada abaixo ou em um ponto do mapa para localizá-la.</p>
            <SavedRouteMap stops={route.stops || []} selectedStopId={selectedStopId} onSelectStop={setSelectedStopId} />
          </section>

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
                const canEdit = !isOrigin && ["draft", "assigned"].includes(route.status);

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
                      {event?.occurrence && event.occurrence !== "entregue" && <small className="stop-address">Ocorrência: {event.occurrence.replaceAll("_", " ")}</small>}
                      {((stop.boxes !== undefined && stop.boxes > 0) || (stop.volume_m3 !== undefined && stop.volume_m3 > 0)) && (
                        <div className="stop-detail-cubagem-tag">
                          {stop.boxes !== undefined && stop.boxes > 0 && <span>📦 {stop.boxes} {stop.boxes === 1 ? "cx" : "cxs"}</span>}
                          {stop.volume_m3 !== undefined && stop.volume_m3 > 0 && <span>📐 {stop.volume_m3} m³</span>}
                        </div>
                      )}

                      {!isOrigin && (
                        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                          <button type="button" className="button secondary compact" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSelectedStopId(stop.id)}>
                            <MapPin size={12} /> Ver no mapa
                          </button>
                          {canEdit && (
                            <button type="button" className="button secondary compact" style={{ fontSize: 11, padding: "3px 8px", color: "#dc2626" }} disabled={editingStop === stop.id} onClick={() => removeStop(stop.id, stop.name)}>
                              {editingStop === stop.id ? "Removendo…" : "Remover cidade"}
                            </button>
                          )}
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
