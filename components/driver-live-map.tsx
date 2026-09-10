"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Crosshair, MapPin, Navigation } from "lucide-react";

export type DriverMapStop = {
  id?: string;
  position?: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_origin?: boolean;
  status?: "pending" | "delivered";
};

export function DriverLiveMap({
  stops,
  currentLocation,
  nextStop,
  status,
}: {
  stops: DriverMapStop[];
  currentLocation: { lat: number; lng: number; accuracy?: number } | null;
  nextStop: DriverMapStop | null;
  status: string;
}) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<import("leaflet").Map | null>(null);
  const driverMarker = useRef<import("leaflet").Marker | null>(null);
  const accuracyCircle = useRef<import("leaflet").Circle | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;

    import("leaflet").then((L) => {
      if (cancelled || !mapElement.current) return;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const initialCenter: [number, number] = currentLocation
        ? [currentLocation.lat, currentLocation.lng]
        : nextStop
          ? [nextStop.lat, nextStop.lng]
          : stops.length > 0
            ? [stops[0].lat, stops[0].lng]
            : [-15.78, -47.93];

      map = L.map(mapElement.current, { zoomControl: true }).setView(
        initialCenter,
        14,
      );
      mapInstance.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);

      const latLngs: import("leaflet").LatLng[] = [];

      // Add stops markers
      stops.forEach((stop, index) => {
        const isNext = nextStop && (stop.id === nextStop.id || (stop.lat === nextStop.lat && stop.lng === nextStop.lng));
        const isDelivered = stop.status === "delivered";
        const isOrigin = stop.is_origin || index === 0;

        const label = isOrigin ? "A" : isDelivered ? "✓" : index;
        const className = `driver-stop-marker ${isOrigin ? "origin" : ""} ${isDelivered ? "delivered" : ""} ${isNext ? "next-pulse" : ""}`;

        const icon = L.divIcon({
          className: "driver-marker-wrap",
          html: `<div class="${className}"><span>${label}</span></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        const stopPoint = L.latLng(stop.lat, stop.lng);
        latLngs.push(stopPoint);

        const tooltipText = isOrigin
          ? `Origem: ${stop.name}`
          : isNext
            ? `⭐ Próxima: ${stop.name}`
            : `${index}. ${stop.name}`;

        L.marker([stop.lat, stop.lng], { icon })
          .bindTooltip(tooltipText, { permanent: !!isNext, direction: "top" })
          .addTo(map!);
      });

      // Draw route polyline if more than 1 stop
      if (stops.length > 1) {
        const polyCoords = stops.map((s) => [s.lat, s.lng] as [number, number]);
        L.polyline(polyCoords, {
          color: "#2563eb",
          weight: 4,
          opacity: 0.8,
          dashArray: "6, 8",
        }).addTo(map);
      }

      // Add driver current location marker
      if (currentLocation) {
        const driverIcon = L.divIcon({
          className: "driver-live-wrap",
          html: `<div class="driver-gps-dot"><span class="gps-halo"></span><span class="gps-core"></span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        driverMarker.current = L.marker([currentLocation.lat, currentLocation.lng], {
          icon: driverIcon,
          zIndexOffset: 1000,
        }).addTo(map);

        if (currentLocation.accuracy && currentLocation.accuracy < 300) {
          accuracyCircle.current = L.circle(
            [currentLocation.lat, currentLocation.lng],
            {
              radius: currentLocation.accuracy,
              color: "#3b82f6",
              fillColor: "#3b82f6",
              fillOpacity: 0.12,
              weight: 1,
            },
          ).addTo(map);
        }

        latLngs.push(L.latLng(currentLocation.lat, currentLocation.lng));
      }

      if (latLngs.length > 1) {
        map.fitBounds(L.latLngBounds(latLngs), { padding: [35, 35], maxZoom: 16 });
      }
    });

    return () => {
      cancelled = true;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [stops, nextStop?.id]);

  // Update driver position dynamically without destroying the map
  useEffect(() => {
    if (!mapInstance.current || !currentLocation) return;
    import("leaflet").then((L) => {
      const pos: [number, number] = [currentLocation.lat, currentLocation.lng];
      if (driverMarker.current) {
        driverMarker.current.setLatLng(pos);
      } else {
        const driverIcon = L.divIcon({
          className: "driver-live-wrap",
          html: `<div class="driver-gps-dot"><span class="gps-halo"></span><span class="gps-core"></span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });
        driverMarker.current = L.marker(pos, {
          icon: driverIcon,
          zIndexOffset: 1000,
        }).addTo(mapInstance.current!);
      }

      if (accuracyCircle.current) {
        accuracyCircle.current.setLatLng(pos);
        if (currentLocation.accuracy) accuracyCircle.current.setRadius(currentLocation.accuracy);
      }
    });
  }, [currentLocation?.lat, currentLocation?.lng, currentLocation?.accuracy]);

  // Invalidate map size on expand/collapse
  useEffect(() => {
    const timer = setTimeout(() => {
      mapInstance.current?.invalidateSize();
    }, 250);
    return () => clearTimeout(timer);
  }, [expanded]);

  const centerDriver = () => {
    if (!mapInstance.current) return;
    if (currentLocation) {
      mapInstance.current.setView([currentLocation.lat, currentLocation.lng], 16);
    } else if (nextStop) {
      mapInstance.current.setView([nextStop.lat, nextStop.lng], 16);
    }
  };

  const centerNext = () => {
    if (!mapInstance.current || !nextStop) return;
    mapInstance.current.setView([nextStop.lat, nextStop.lng], 16);
  };

  return (
    <div className={`driver-map-wrapper ${expanded ? "expanded" : ""}`}>
      <div className="driver-map-bar">
        <div className="driver-map-tag">
          <span className={`status-dot ${status === "active" ? "active" : ""}`} />
          <small>{status === "active" ? "GPS em tempo real" : "Visualização de paradas"}</small>
        </div>
        <div className="driver-map-actions">
          {currentLocation && (
            <button
              type="button"
              className="map-tool-btn"
              onClick={centerDriver}
              title="Minha posição"
            >
              <Crosshair size={15} /> Minha posição
            </button>
          )}
          {nextStop && (
            <button
              type="button"
              className="map-tool-btn"
              onClick={centerNext}
              title="Próxima entrega"
            >
              <MapPin size={15} /> Próxima
            </button>
          )}
          <button
            type="button"
            className="map-tool-btn toggle-size"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Recolher mapa" : "Expandir mapa"}
          >
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {expanded ? "Menor" : "Maior"}
          </button>
        </div>
      </div>
      <div ref={mapElement} className="leaflet-driver-map" />
      {expanded && (
        <button
          type="button"
          className="driver-map-floating-close"
          onClick={() => setExpanded(false)}
        >
          <ChevronUp size={15} /> Recolher mapa
        </button>
      )}
    </div>
  );
}
