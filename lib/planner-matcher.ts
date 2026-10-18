import type { EngineConfig, SuggestedRoute } from "./route-engine";

function stopSignature(stop: {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  is_origin?: boolean;
  boxes?: number | null;
  volume_m3?: number | null;
  order_ids?: string[];
}): string {
  return JSON.stringify([
    stop.name,
    stop.address,
    stop.lat,
    stop.lng,
    Boolean(stop.is_origin),
    stop.boxes ?? null,
    stop.volume_m3 ?? null,
    stop.order_ids ?? [],
  ]);
}

export function matchPlannerStops(
  suggested: SuggestedRoute,
  config: EngineConfig,
  stops: unknown
): number[] | null {
  if (
    !Array.isArray(stops) ||
    stops.length !== suggested.stops.length + 1 ||
    stops.some((s) => !s)
  ) {
    return null;
  }
  const expected = [
    {
      name: config.originName ? `Origem (${config.originName})` : "Origem (CD Base)",
      address: "Base Operacional de Distribuição",
      lat: config.originLat,
      lng: config.originLng,
      is_origin: true,
    },
    ...suggested.stops.map((s) => ({
      name: s.clientName ? `${s.clientName} - ${s.city}` : s.city,
      address: s.address || s.city,
      lat: s.lat,
      lng: s.lng,
      boxes: s.boxes,
      volume_m3: s.volumeM3,
      order_ids: [...new Set(s.orders.map((o) => o.orderId))],
      is_origin: false,
    })),
  ];
  if (stopSignature(stops[0]) !== stopSignature(expected[0])) {
    return null;
  }
  const used = new Set<number>();
  const permutation: number[] = [];
  for (const s of stops.slice(1)) {
    const idx = expected.findIndex(
      (exp, i) => i > 0 && !used.has(i) && stopSignature(exp) === stopSignature(s)
    );
    if (idx < 0) return null;
    used.add(idx);
    permutation.push(idx - 1);
  }
  return permutation;
}
