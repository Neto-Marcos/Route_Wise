"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export type RouteMapItem = {
  id: string;
  name: string;
  status: string;
  driver_id?: string | null;
  driver_name?: string;
  vehicle_name?: string;
  plate?: string;
  deliveries: number;
  delivered: number;
  last_location?: { lat: number; lng: number; recorded_at: string };
};

export type ActiveRoutePoint = RouteMapItem;

export function formatLastPositionTime(
  recordedAt?: string | null,
  now = Date.now(),
) {
  if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
    return "Horário não disponível";
  }
  const ts = Date.parse(recordedAt);
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
  const diff = now - ts;
  const relative =
    diff < 0
      ? "horário informado pela origem"
      : diff < 60_000
        ? "há menos de 1 min"
        : diff < 3_600_000
          ? `há ${Math.floor(diff / 60_000)} min`
          : `há ${Math.floor(diff / 3_600_000)} h`;
  return `${formatted} · ${relative}`;
}

function escapeHtml(str: string) {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (ch) => map[ch]);
}

export function LiveFleetMap({
  routes,
  onSelectRoute,
}: {
  routes: RouteMapItem[];
  onSelectRoute?: (routeId: string) => void;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<import("leaflet").Map | null>(null);
  const markersLayer = useRef<import("leaflet").LayerGroup | null>(null);
  const initialFitDone = useRef(false);
  const [mapReady, setMapReady] = useState(false);

  const activeRoutesWithLoc = useMemo(
    () =>
      routes.filter(
        (r) =>
          r.last_location &&
          (r.status === "active" || r.status === "assigned"),
      ),
    [routes],
  );

  // Initialize map once
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    import("leaflet").then((L) => {
      if (cancelled || !mapElement.current) return;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
      if ((mapElement.current as any)._leaflet_id) {
        delete (mapElement.current as any)._leaflet_id;
      }

      const map = L.map(mapElement.current, { zoomControl: true }).setView(
        [-15.78, -47.93],
        4,
      );
      mapInstance.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);

      const layer = L.layerGroup().addTo(map);
      markersLayer.current = layer;
      setMapReady(true);

      resizeObserver = new ResizeObserver(() =>
        map.invalidateSize({ pan: false }),
      );
      resizeObserver.observe(mapElement.current);
    });

    if (typeof window !== "undefined" && onSelectRoute) {
      (window as any).__selectRoute = (id: string) => onSelectRoute(id);
    }

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        markersLayer.current = null;
      }
      if (mapElement.current && (mapElement.current as any)._leaflet_id) {
        delete (mapElement.current as any)._leaflet_id;
      }
      if (typeof window !== "undefined") {
        delete (window as any).__selectRoute;
      }
    };
  }, []);

  // Keep window.__selectRoute up to date with prop
  useEffect(() => {
    if (typeof window !== "undefined" && onSelectRoute) {
      (window as any).__selectRoute = (id: string) => onSelectRoute(id);
    }
  }, [onSelectRoute]);

  // Update markers smoothly without re-creating map on 10s poll
  useEffect(() => {
    if (!mapReady || !mapInstance.current || !markersLayer.current) return;

    import("leaflet").then((L) => {
      if (!mapInstance.current || !markersLayer.current) return;
      const layer = markersLayer.current;
      layer.clearLayers();

      const latLngs: import("leaflet").LatLng[] = [];

      activeRoutesWithLoc.forEach((r) => {
        if (!r.last_location) return;
        const { lat, lng, recorded_at } = r.last_location;
        const isActive = r.status === "active";
        const point = L.latLng(lat, lng);
        latLngs.push(point);

        const icon = L.divIcon({
          className: "fleet-marker-wrap",
          html: `<div class="fleet-marker ${isActive ? "active" : ""}">
              <span class="fleet-icon">🚛</span>
              ${isActive ? '<span class="fleet-pulse"></span>' : ""}
            </div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        });

        const timeStr = formatLastPositionTime(recorded_at);

        const popupHtml = `
            <div class="fleet-popup">
              <div class="popup-title">
                <strong>${escapeHtml(r.name)}</strong>
                <span class="popup-status ${r.status}">${isActive ? "Em rota" : "Atribuída"}</span>
              </div>
              <p class="popup-meta">
                <span>👤 ${escapeHtml(r.driver_name || "Motorista não informado")}</span>
                <span>🚛 ${escapeHtml([r.vehicle_name, r.plate].filter(Boolean).join(" · ") || "Veículo não informado")}</span>
              </p>
              <div class="popup-progress">
                <span>Progresso: <b>${r.delivered}/${r.deliveries}</b></span>
                <small>Última posição: ${escapeHtml(timeStr)}</small>
              </div>
              ${
                onSelectRoute
                  ? `<button type="button" class="popup-button" onclick="window.__selectRoute(${escapeHtml(JSON.stringify(r.id))})">Ver rota</button>`
                  : ""
              }
            </div>
          `;

        const marker = L.marker([lat, lng], {
          icon,
          title: `${r.driver_name || "Motorista não informado"} · ${r.name}`,
          alt: `Última posição da rota ${r.name}`,
        }).bindPopup(popupHtml);
        layer.addLayer(marker);
      });

      if (!initialFitDone.current && latLngs.length > 0) {
        initialFitDone.current = true;
        if (latLngs.length === 1) {
          mapInstance.current.setView(latLngs[0], 14);
        } else {
          mapInstance.current.fitBounds(L.latLngBounds(latLngs), {
            padding: [40, 40],
            maxZoom: 15,
          });
        }
      }
    });
  }, [mapReady, activeRoutesWithLoc, onSelectRoute]);

  const recenter = () => {
    if (!mapInstance.current || activeRoutesWithLoc.length === 0) return;
    import("leaflet").then((L) => {
      const points = activeRoutesWithLoc.map((r) =>
        L.latLng(r.last_location!.lat, r.last_location!.lng),
      );
      if (points.length === 1) {
        mapInstance.current?.setView(points[0], 14);
      } else {
        mapInstance.current?.fitBounds(L.latLngBounds(points), {
          padding: [40, 40],
          maxZoom: 15,
        });
      }
    });
  };

  return (
    <div className="live-fleet-container">
      <div className="fleet-map-toolbar">
        <div className="fleet-map-info">
          <span className="live-badge">
            <i /> Posições registradas
          </span>
          <small>
            {activeRoutesWithLoc.length > 0
              ? `${activeRoutesWithLoc.length} rota(s) com última posição recebida`
              : "Nenhuma posição recebida para as rotas atuais"}
          </small>
        </div>
        {activeRoutesWithLoc.length > 0 && (
          <button
            type="button"
            className="fleet-recenter-btn"
            onClick={recenter}
            title="Centralizar frota"
          >
            <CrosshairIcon /> Centralizar
          </button>
        )}
      </div>
      <div ref={mapElement} className="leaflet-fleet-map" />
    </div>
  );
}

function CrosshairIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}
