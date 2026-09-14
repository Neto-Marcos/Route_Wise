"use client";

import React, { useEffect, useRef } from "react";
import { X, Flame } from "lucide-react";
import { haptics } from "@/lib/haptics";

export function CityHeatmapModal({
  onClose,
  points,
}: {
  onClose: () => void;
  points: Array<[number, number, number]>;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !mapContainerRef.current) return;

    let isMounted = true;

    async function initMap() {
      const L = (await import("leaflet")).default;

      if (!isMounted || !mapContainerRef.current) return;

      // Se já houver instância, destrói para evitar conflito
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      if ((mapContainerRef.current as any)._leaflet_id) {
        delete (mapContainerRef.current as any)._leaflet_id;
      }

      const defaultCenter: [number, number] = points.length > 0 ? [points[0][0], points[0][1]] : [-23.5505, -46.6333];
      const map = L.map(mapContainerRef.current).setView(defaultCenter, points.length > 0 ? 10 : 7);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      // Renderiza marcadores com gradiente de calor (círculos radiantes)
      points.forEach(([lat, lng, intensity]) => {
        L.circle([lat, lng], {
          radius: 1800,
          color: "#ea580c",
          fillColor: "#f97316",
          fillOpacity: 0.35,
          weight: 1.5,
        }).addTo(map);

        L.circle([lat, lng], {
          radius: 600,
          color: "#dc2626",
          fillColor: "#ef4444",
          fillOpacity: 0.75,
          weight: 0,
        }).addTo(map);
      });

      if (points.length > 1) {
        const bounds = L.latLngBounds(points.map(([lat, lng]) => [lat, lng]));
        map.fitBounds(bounds, { padding: [30, 30] });
      }

      window.setTimeout(() => {
        map.invalidateSize();
      }, 200);
    }

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      if (mapContainerRef.current && (mapContainerRef.current as any)._leaflet_id) {
        delete (mapContainerRef.current as any)._leaflet_id;
      }
    };
  }, [points]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "grid",
        placeItems: "center",
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          haptics.tap();
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "850px",
          height: "80vh",
          background: "var(--card, #ffffff)",
          borderRadius: "18px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--line)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Flame size={20} color="#ea580c" />
            <div>
              <b style={{ fontSize: "16px", color: "var(--ink)" }}>Heatmap de Concentração de Entregas</b>
              <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
                {points.length} pontos de paradas georreferenciados
              </p>
            </div>
          </div>
          <button
            type="button"
            className="button secondary compact"
            onClick={() => {
              haptics.tap();
              onClose();
            }}
            style={{ width: "32px", height: "32px", padding: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <div ref={mapContainerRef} style={{ flex: 1, width: "100%", background: "#e2e8f0" }} />
      </div>
    </div>
  );
}
