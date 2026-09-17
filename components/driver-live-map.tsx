"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Crosshair, MapPin } from "lucide-react";

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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

type RoadPlace = {
  id: string;
  name: string;
  kind: "restaurant" | "lodging" | "rest_area";
  lat: number;
  lng: number;
  address?: string;
  openingHours?: string;
  parking?: boolean;
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

  // Filtros rápidos no app do motorista
  const [filterStations, setFilterStations] = useState(true);
  const [filterRestaurants, setFilterRestaurants] = useState(true);
  const [filterLodging, setFilterLodging] = useState(true);
  const [roadPlaces, setRoadPlaces] = useState<RoadPlace[]>([]);

  // Alerta Lei 13.103 (Lei do Motorista)
  const [routeDurationHours, setRouteDurationHours] = useState<number | null>(null);
  const [dismissRestAlert, setDismissRestAlert] = useState(false);

  // Grupos de camadas para controle de exibição dinâmica
  const stationsLayerGroup = useRef<import("leaflet").LayerGroup | null>(null);
  const restLayerGroup = useRef<import("leaflet").LayerGroup | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | undefined;

    import("leaflet").then((L) => {
      if (cancelled || !mapElement.current) return;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
      if ((mapElement.current as any)._leaflet_id) {
        delete (mapElement.current as any)._leaflet_id;
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

      // Cria os LayerGroups para permitir alternar os filtros de 1 toque sem recriar o mapa
      stationsLayerGroup.current = L.layerGroup().addTo(map);
      restLayerGroup.current = L.layerGroup().addTo(map);
      setMapReady(true);

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

      // Draw real route geometry from OSRM & compute duration for Lei 13.103
      if (stops.length > 1) {
        const polyline = L.polyline(stops.map((s) => [s.lat, s.lng]), {
          color: "#2563eb",
          weight: 5,
          opacity: 0.88,
        }).addTo(map);

        const stopsToRoute = [...stops];
        const coordsParam = stopsToRoute.map((s, idx) => {
          let lat = s.lat;
          let lng = s.lng;
          for (let j = 0; j < idx; j++) {
            if (Math.abs(stopsToRoute[j].lat - lat) < 0.0002 && Math.abs(stopsToRoute[j].lng - lng) < 0.0002) {
              lat += 0.00025 * (idx - j);
              lng += 0.00025 * (idx - j);
              break;
            }
          }
          return `${lng.toFixed(6)},${lat.toFixed(6)}`;
        }).join(";");

        const fetchRoute = async () => {
          try {
            const res = await fetch(`/api/osrm/route/v1/driving/${coordsParam}?overview=full&geometries=geojson`);
            const data = await res.json();
            if (!cancelled && data?.routes?.[0]?.geometry?.coordinates) {
              const pts = data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
              polyline.setLatLngs(pts);
              if (data.routes[0].duration) {
                setRouteDurationHours(data.routes[0].duration / 3600);
              }
              return;
            }
          } catch {}

          try {
            const res = await fetch(`/api/osrm/trip/v1/driving/${coordsParam}?source=first&roundtrip=false&overview=full&geometries=geojson`);
            const data = await res.json();
            if (!cancelled && data?.trips?.[0]?.geometry?.coordinates) {
              const pts = data.trips[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
              polyline.setLatLngs(pts);
              if (data.trips[0].duration) {
                setRouteDurationHours(data.trips[0].duration / 3600);
              }
            }
          } catch {}
        };

        fetchRoute();
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
        stationsLayerGroup.current = null;
        restLayerGroup.current = null;
        setMapReady(false);
      }
      if (mapElement.current && (mapElement.current as any)._leaflet_id) {
        delete (mapElement.current as any)._leaflet_id;
      }
    };
  }, [stops, nextStop?.id]);

  // Atualiza marcadores de Postos conforme filtro de 1 toque
  useEffect(() => {
    if (!mapReady || !stationsLayerGroup.current) return;
    stationsLayerGroup.current.clearLayers();
    if (!filterStations) return;

    import("leaflet").then((L) => {
      fetch("/api/stations")
        .then((r) => r.json())
        .then((stations: any[]) => {
          if (!Array.isArray(stations) || !stationsLayerGroup.current) return;
          stations
            .map((st) => {
              const sLat = parseFloat(String(st.latitude).replace(",", "."));
              const sLng = parseFloat(String(st.longitude).replace(",", "."));
              if (isNaN(sLat) || isNaN(sLng)) return null;
              const minD = Math.min(...stops.map((sp) => calcDistanceKm(sp.lat, sp.lng, sLat, sLng)));
              return { ...st, distance: minD, sLat, sLng };
            })
            .filter((st): st is NonNullable<typeof st> => st !== null && st.distance <= 35)
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

              const m = L.marker([st.sLat, st.sLng], { icon: fuelIcon }).bindPopup(popupHtml);
              stationsLayerGroup.current?.addLayer(m);
            });
        })
        .catch(() => {});
    });
  }, [filterStations, stops, mapReady]);

  useEffect(() => {
    if (!stops.length) {
      setRoadPlaces([]);
      return;
    }
    const controller = new AbortController();
    const coords = stops.map((stop) => `${stop.lat},${stop.lng}`).join(";");
    fetch(`/api/road-places?coords=${encodeURIComponent(coords)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : [])
      .then((places) => setRoadPlaces(Array.isArray(places) ? places : []))
      .catch((error) => {
        if (error?.name !== "AbortError") setRoadPlaces([]);
      });
    return () => controller.abort();
  }, [stops]);

  // Atualiza marcadores de Restaurantes e Pousadas/Pátios conforme filtros de 1 toque
  useEffect(() => {
    if (!mapReady || !restLayerGroup.current) return;
    restLayerGroup.current.clearLayers();
    if (!filterRestaurants && !filterLodging) return;

    import("leaflet").then((L) => {
      const balancedPlaces = [
        ...roadPlaces.filter((place) => place.kind === "restaurant").slice(0, 10),
        ...roadPlaces.filter((place) => place.kind !== "restaurant").slice(0, 10),
      ];
      const dynamicPlaces = balancedPlaces.map((place) => ({
        ...place,
        category: place.kind === "restaurant" ? "restaurante" : place.kind === "lodging" ? "pousada" : "patio_seguro",
        highway: place.address || "Próximo ao trajeto",
        city: "",
        state: "",
        features: [place.openingHours ? `Horário: ${place.openingHours}` : "Consulte o funcionamento", place.parking ? "Estacionamento informado" : ""].filter(Boolean),
        notes: place.kind === "rest_area" ? "Área de descanso mapeada no OpenStreetMap." : "Local mapeado próximo ao corredor da rota.",
      }));
      [...dynamicPlaces, ...REST_STOPS].map((rs) => {
        const minD = Math.min(...stops.map((sp) => calcDistanceKm(sp.lat, sp.lng, rs.lat, rs.lng)));
        return { ...rs, distance: minD };
      })
        .filter((rs) => {
          if (rs.distance > 80) return false;
          if (rs.category === "restaurante" && !filterRestaurants) return false;
          if ((rs.category === "pousada" || rs.category === "patio_seguro") && !filterLodging) return false;
          return true;
        })
        .slice(0, 20)
        .forEach((rs) => {
          const isLodging = rs.category === "pousada" || rs.category === "patio_seguro";
          const iconEmoji = rs.category === "pousada" ? "🛏️" : rs.category === "restaurante" ? "🍽️" : "🅿️";
          const bgColor = isLodging ? "#7c3aed" : "#ea580c";

          const restIcon = L.divIcon({
            className: "rest-map-marker-wrap",
            html: `<span class="rest-map-marker" style="background:${bgColor};color:#fff;border-radius:50%;padding:3px 5px;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;display:grid;place-items:center;" title="${rs.name}">${iconEmoji}</span>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });

          const popupHtml = `
            <div style="font-size:12px;line-height:1.4">
              <b>${iconEmoji} ${escapeHtml(rs.name)}</b><br/>
              <span style="color:#64748b">${escapeHtml([rs.highway, rs.city, rs.state].filter(Boolean).join(" · "))}</span><br/>
              <span style="color:${bgColor};font-weight:700;">${rs.distance.toFixed(1)} km da rota</span><br/>
              <small>${escapeHtml(rs.features.join(", "))}</small><br/>
              <em style="font-size:11px;color:#10b981;">${escapeHtml(rs.notes)}</em>
            </div>
          `;

          const m = L.marker([rs.lat, rs.lng], { icon: restIcon }).bindPopup(popupHtml);
          restLayerGroup.current?.addLayer(m);
        });
    });
  }, [filterRestaurants, filterLodging, stops, mapReady, roadPlaces]);

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

  const isLongTrip = (routeDurationHours !== null && routeDurationHours >= 4) || stops.length >= 8;

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
            🗺️ Rota
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

      {/* Barra de filtros rápidos de postos, restaurantes e hospedagens próximas */}
      <div className="driver-map-filters-row">
        <button
          type="button"
          className={`quick-filter-chip ${filterStations ? "active" : ""}`}
          onClick={() => setFilterStations(!filterStations)}
          title="Exibir ou ocultar postos eFleet com preço de diesel"
        >
          <span>⛽</span> Postos
        </button>
        <button
          type="button"
          className={`quick-filter-chip ${filterRestaurants ? "active" : ""}`}
          onClick={() => setFilterRestaurants(!filterRestaurants)}
          title="Exibir ou ocultar restaurantes e churrascarias de rodovia"
        >
          <span>🍽️</span> Restaurantes
        </button>
        <button
          type="button"
          className={`quick-filter-chip ${filterLodging ? "active" : ""}`}
          onClick={() => setFilterLodging(!filterLodging)}
          title="Exibir ou ocultar hospedagens e áreas de descanso próximas"
        >
          <span>🛏️</span> Pernoite
        </button>
      </div>

      {/* Alerta Parada Obrigatória da Lei do Motorista (Lei 13.103) */}
      {isLongTrip && !dismissRestAlert && (
        <div className="driver-rest-law-banner">
          <div className="rest-law-content">
            <b>⚠️ Lei 13.103 (Descanso Obrigatório)</b>
            <p>
              Viagem estimada em {routeDurationHours ? `${routeDurationHours.toFixed(1)}h` : "longo percurso"}.
              Recomendada parada de 30 minutos a cada 4h/5h30 de direção contínua. Consulte opções de parada no mapa e confirme a estrutura do local.
            </p>
          </div>
          <button
            type="button"
            className="rest-law-dismiss"
            onClick={() => setDismissRestAlert(true)}
            title="Fechar aviso"
          >
            Entendido
          </button>
        </div>
      )}

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
