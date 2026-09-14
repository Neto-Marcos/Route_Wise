import { query } from "@/lib/db";
import type { OrderRow } from "@/lib/spreadsheet-parser";
import { normCity } from "@/lib/route-engine";

type Geocode = { lat: number; lng: number; displayName?: string };

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

async function lookupCache(city: string, uf: string): Promise<Geocode | null> {
  const result = await query<{ lat: number; lng: number; display_name: string }>(
    "SELECT lat,lng,display_name FROM city_geocodes WHERE city_normalized=$1 AND uf=$2 LIMIT 1",
    [city, uf],
  );
  const row = result.rows[0];
  return row && valid(Number(row.lat), Number(row.lng)) ? { lat: Number(row.lat), lng: Number(row.lng), displayName: row.display_name } : null;
}

async function geocodeCity(city: string, uf: string): Promise<Geocode | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const params = new URLSearchParams({ q: `${city}${uf ? `, ${uf}` : ""}, Brasil`, format: "jsonv2", limit: "1", countrycodes: "br" });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": process.env.GEOCODING_USER_AGENT || "RouteWise/2.0 contact@criarrota.com.br", "Accept-Language": "pt-BR" },
      signal: controller.signal,
      next: { revalidate: 0 },
    });
    if (!response.ok) return null;
    const matches = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
    const match = matches[0];
    const lat = Number(match?.lat), lng = Number(match?.lon);
    return match && valid(lat, lng) ? { lat, lng, displayName: match.display_name } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Completa coordenadas ausentes por cidade/UF. O limite conserva o serviço
 * público de geocoding; cidades restantes são resolvidas em importações futuras
 * a partir do cache já construído.
 */
export async function resolveOrderCoordinates(orders: OrderRow[], maxRemoteLookups = 25): Promise<OrderRow[]> {
  const resolved = new Map<string, Geocode | null>();
  let remoteLookups = 0;
  for (const order of orders) {
    if (valid(Number(order.lat), Number(order.lng))) continue;
    const city = normCity(order.city || "");
    const uf = String(order.uf || "").trim().toUpperCase();
    if (!city) continue;
    const key = `${uf}|${city}`;
    if (!resolved.has(key)) {
      let point = await lookupCache(city, uf).catch(() => null);
      if (!point && remoteLookups < maxRemoteLookups) {
        remoteLookups += 1;
        point = await geocodeCity(city, uf);
        // Nominatim pede no máximo uma consulta por segundo.
        await new Promise((resolve) => setTimeout(resolve, 1050));
        if (point) {
          await query(
            `INSERT INTO city_geocodes(city_normalized,uf,display_name,lat,lng,source)
             VALUES($1,$2,$3,$4,$5,'nominatim')
             ON CONFLICT(city_normalized,uf) DO UPDATE SET display_name=EXCLUDED.display_name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,verified_at=now()`,
            [city, uf, point.displayName || null, point.lat, point.lng],
          ).catch(() => {});
        }
      }
      resolved.set(key, point);
    }
    const point = resolved.get(key);
    if (point) { order.lat = point.lat; order.lng = point.lng; }
  }
  return orders;
}
