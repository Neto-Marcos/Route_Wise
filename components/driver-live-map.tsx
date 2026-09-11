"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Crosshair, MapPin, Navigation } from "lucide-react";

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

// Pontos de parada seguros para motoristas (Lei do Descanso / ANTT)
const REST_STOPS = [
  {
    id: "rs-1",
    name: "Rede Graal - Estrela da Serra",
    category: "pousada",
    highway: "BR-116 km 448",
    city: "Registro",
    state: "SP",
    lat: -24.4947,
    lng: -47.8488,
    features: ["Hotel", "Ducha quente", "Pátio 24h", "Restaurante"],
    notes: "Pátio credenciado ANTT / Lei do Descanso.",
  },
  {
    id: "rs-2",
    name: "Rede Graal - Barueri",
    category: "restaurante",
    highway: "SP-280 km 29",
    city: "Barueri",
    state: "SP",
    lat: -23.5112,
    lng: -46.8765,
    features: ["Restaurante", "Lanchonete 24h", "Estacionamento"],
    notes: "Conveniência e refeições 24h.",
  },
  {
    id: "rs-3",
    name: "Posto Sakamoto - Pátio Seguro & Hotel",
    category: "patio_seguro",
    highway: "BR-116 km 210",
    city: "Guarulhos",
    state: "SP",
    lat: -23.4418,
    lng: -46.4715,
    features: ["Pátio CFTV", "Pousada com ar", "Vestiários"],
    notes: "Pátio monitorado tradicional para carretas.",
  },
  {
    id: "rs-4",
    name: "Rede Frango Assado - Carvalho Pinto",
    category: "restaurante",
    highway: "SP-070 km 94",
    city: "São José dos Campos",
    state: "SP",
    lat: -23.2384,
    lng: -45.8942,
    features: ["Restaurante", "Pátio iluminado", "Banheiros"],
    notes: "Estrutura para refeição e descanso rápido.",
  },
  {
    id: "rs-5",
    name: "Posto Marajó - Central Pátio & Pousada",
    category: "patio_seguro",
    highway: "BR-153 km 128",
    city: "Aparecida de Goiânia",
    state: "GO",
    lat: -16.7915,
    lng: -49.2458,
    features: ["Hotel caminhoneiro", "Pátio seguro", "Churrascaria"],
    notes: "Lei do Descanso: vigilância armada 24h.",
  },
  {
    id: "rs-6",
    name: "Rede Décio - Trevão de Itumbiara",
    category: "pousada",
    highway: "BR-153 com BR-452",
    city: "Itumbiara",
    state: "GO",
    lat: -18.4189,
    lng: -49.2155,
    features: ["Hotel Décio", "Restaurante & Grill", "Pátio monitorado"],
    notes: "Excelente complexo com pernoite tranquilo.",
  },
  {
    id: "rs-7",
    name: "Churrascaria e Pousada do Gaúcho",
    category: "restaurante",
    highway: "BR-101 Sul km 112",
    city: "Itajaí",
    state: "SC",
    lat: -26.9078,
    lng: -48.6923,
    features: ["Rodízio", "Pousada", "Estacionamento seguro"],
    notes: "Ponto estratégico litoral catarinense.",
  },
  {
    id: "rs-8",
    name: "Posto & Pousada Belvedere",
    category: "pousada",
    highway: "BR-277 km 114",
    city: "Campo Largo",
    state: "PR",
    lat: -25.4523,
    lng: -49.5298,
    features: ["Quartos duplos", "Duchas quentes", "Segurança armada"],
    notes: "Ponto seguro para subida/descida Porto de Paranaguá.",
  },
  {
    id: "rs-9",
    name: "Pátio e Hotel Rodoviário Trevo de Minas",
    category: "patio_seguro",
    highway: "BR-381 km 690",
    city: "Lavras",
    state: "MG",
    lat: -21.2482,
    lng: -45.0012,
    features: ["Pátio asfaltado monitorado", "Hotel 24h", "Restaurante"],
    notes: "Pernoite tranquilo na Fernão Dias.",
  },
  {
    id: "rs-10",
    name: "Posto e Churrascaria La Carreta",
    category: "restaurante",
    highway: "BR-040 km 794",
    city: "Juiz de Fora",
    state: "MG",
    lat: -21.7645,
    lng: -43.3498,
    features: ["Churrascaria", "Amplo pátio", "Conveniência 24h"],
    notes: "Ponto tradicional BR-040.",
  },
];

function calcDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

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

      // Draw real route geometry from OSRM
      if (stops.length > 1) {
        const polyline = L.polyline(stops.map((s) => [s.lat, s.lng]), {
          color: "#2563eb",
          weight: 5,
          opacity: 0.88,
        }).addTo(map);

        const coordsParam = stops.map((s) => `${s.lng},${s.lat}`).join(";");
        fetch(`/api/osrm/trip/v1/driving/${coordsParam}?source=first&roundtrip=false&overview=full&geometries=geojson`)
          .then((r) => r.json())
          .then((data) => {
            if (!cancelled && data?.trips?.[0]?.geometry?.coordinates) {
              const pts = data.trips[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
              polyline.setLatLngs(pts);
            }
          })
          .catch(() => {});
      }

      // Add fuel stations near route
      try {
        fetch("/api/stations")
          .then((r) => r.json())
          .then((stations: any[]) => {
            if (cancelled || !Array.isArray(stations) || !map) return;
            stations
              .map((st) => {
                const sLat = parseFloat(String(st.latitude).replace(",", "."));
                const sLng = parseFloat(String(st.longitude).replace(",", "."));
                if (isNaN(sLat) || isNaN(sLng)) return null;
                const minD = Math.min(...stops.map((sp) => calcDistanceKm(sp.lat, sp.lng, sLat, sLng)));
                return { ...st, distance: minD, sLat, sLng };
              })
              .filter((st): st is NonNullable<typeof st> => st !== null && st.distance <= 30)
              .sort((a, b) => a.distance - b.distance)
              .slice(0, 15)
              .forEach((st) => {
                const fuelIcon = L.divIcon({
                  className: "fuel-map-marker-wrap",
                  html: `<span class="fuel-map-marker" style="background:#0284c7;color:#fff;border-radius:50%;padding:3px 5px;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;display:grid;place-items:center;" title="Posto: ${st.nome}">⛽</span>`,
                  iconSize: [24, 24],
                  iconAnchor: [12, 12],
                });

                const popupHtml = `
                  <div style="font-size:12px;line-height:1.4">
                    <b>⛽ ${st.nome}</b><br/>
                    <span style="color:#64748b">${st.cidade}/${st.estado}</span><br/>
                    <span>${st.distance.toFixed(1)} km da rota</span>
                    ${st.diesels10 ? `<br/><b style="color:#16a34a">S10: R$ ${st.diesels10}</b>` : ""}
                  </div>
                `;

                L.marker([st.sLat, st.sLng], { icon: fuelIcon })
                  .bindPopup(popupHtml)
                  .addTo(map!);
              });
          })
          .catch(() => {});
      } catch (err) {}

      // Add rest stops / safe parking
      if (stops.length > 0) {
        REST_STOPS.map((rs) => {
          const minD = Math.min(...stops.map((sp) => calcDistanceKm(sp.lat, sp.lng, rs.lat, rs.lng)));
          return { ...rs, distance: minD };
        })
          .filter((rs) => rs.distance <= 70)
          .slice(0, 8)
          .forEach((rs) => {
            const iconEmoji = rs.category === "pousada" ? "🛌" : rs.category === "restaurante" ? "🍽️" : "🅿️";
            const restIcon = L.divIcon({
              className: "rest-map-marker-wrap",
              html: `<span class="rest-map-marker" style="background:#059669;color:#fff;border-radius:50%;padding:3px 5px;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;display:grid;place-items:center;" title="${rs.name}">${iconEmoji}</span>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            });

            const popupHtml = `
              <div style="font-size:12px;line-height:1.4">
                <b>${iconEmoji} ${rs.name}</b><br/>
                <span style="color:#64748b">${rs.highway} · ${rs.city}/${rs.state}</span><br/>
                <span style="color:#059669;font-weight:700;">${rs.distance.toFixed(1)} km da rota</span><br/>
                <small>${rs.features.slice(0, 2).join(", ")}</small>
              </div>
            `;

            L.marker([rs.lat, rs.lng], { icon: restIcon })
              .bindPopup(popupHtml)
              .addTo(map!);
          });
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

  const fitFullRoute = () => {
    if (!mapInstance.current || !stops.length) return;
    import("leaflet").then((L) => {
      const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number]));
      mapInstance.current?.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
    });
  };

  return (
    <div className={`driver-map-wrapper ${expanded ? "expanded" : ""}`}>
      <div className="driver-map-bar">
        <div className="driver-map-tag">
          <span className={`status-dot ${status === "active" ? "active" : ""}`} />
          <small>{status === "active" ? "GPS & Traçado Oficial" : "Visualização de paradas"}</small>
        </div>
        <div className="driver-map-actions">
          <button
            type="button"
            className="map-tool-btn"
            onClick={fitFullRoute}
            title="Ver trajeto completo planejado"
          >
            🗺️ Ver rota
          </button>
          {currentLocation && (
            <button
              type="button"
              className="map-tool-btn"
              onClick={centerDriver}
              title="Minha posição"
            >
              <Crosshair size={15} /> Posição
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
