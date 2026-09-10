"use client";
import { useEffect, useRef } from "react";

export type RouteMapItem = {
  id: string;
  name: string;
  status: string;
  driver_name?: string;
  vehicle_name?: string;
  plate?: string;
  deliveries: number;
  delivered: number;
  last_location?: { lat: number; lng: number; recorded_at: string };
};

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

  const activeRoutesWithLoc = routes.filter(
    (r) => r.last_location && (r.status === "active" || r.status === "assigned"),
  );

  // Initialize map once
  useEffect(() => {
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapElement.current) return;
      if (mapInstance.current) return;

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
    });

    if (typeof window !== "undefined" && onSelectRoute) {
      (window as any).__selectRoute = (id: string) => onSelectRoute(id);
    }

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
        markersLayer.current = null;
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
    if (!mapInstance.current || !markersLayer.current) {
      // Map may still be loading Leaflet module, check again on next tick
      const timer = setTimeout(() => {
        if (!mapInstance.current || !markersLayer.current) return;
        renderMarkers();
      }, 300);
      return () => clearTimeout(timer);
    }
    renderMarkers();

    function renderMarkers() {
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

          const timeStr = recorded_at
            ? new Date(recorded_at).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "--:--";

          const popupHtml = `
            <div class="fleet-popup">
              <div class="popup-title">
                <strong>${r.name}</strong>
                <span class="popup-status ${r.status}">${isActive ? "Em rota" : "Atribuída"}</span>
              </div>
              <p class="popup-meta">
                <span>👤 ${r.driver_name || "Motorista"}</span>
                <span>🚛 ${r.plate || r.vehicle_name || "Veículo"}</span>
              </p>
              <div class="popup-progress">
                <span>Progresso: <b>${r.delivered}/${r.deliveries}</b></span>
                <small>Último sinal: ${timeStr}</small>
              </div>
              ${
                onSelectRoute
                  ? `<button class="popup-button" onclick="window.__selectRoute('${r.id}')">Ver detalhes da rota</button>`
                  : ""
              }
            </div>
          `;

          const marker = L.marker([lat, lng], { icon }).bindPopup(popupHtml);
          layer.addLayer(marker);
        });

        // Fit bounds only once initially if positions are available
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
    }
  }, [activeRoutesWithLoc, onSelectRoute]);

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
            <i /> Ao vivo
          </span>
          <small>
            {activeRoutesWithLoc.length > 0
              ? `${activeRoutesWithLoc.length} motorista(s) transmitindo GPS`
              : "Nenhum sinal GPS ativo no momento"}
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="7" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
    </svg>
  );
}
