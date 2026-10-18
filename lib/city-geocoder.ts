import { query } from "./db";
import { normCity } from "./route-engine";
import type { OrderRow } from "./spreadsheet-parser";

const isValidCoords = (lat: number, lng: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

async function findCachedGeocode(cityNorm: string, uf: string) {
  const row = (
    await query<{ lat: number | string; lng: number | string; display_name: string | null }>(
      "SELECT lat,lng,display_name FROM city_geocodes WHERE city_normalized=$1 AND uf=$2 LIMIT 1",
      [cityNorm, uf]
    )
  ).rows[0];
  return row && isValidCoords(Number(row.lat), Number(row.lng))
    ? {
        lat: Number(row.lat),
        lng: Number(row.lng),
        displayName: row.display_name,
      }
    : null;
}

async function fetchNominatimGeocode(cityNorm: string, uf: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const params = new URLSearchParams({
      q: `${cityNorm}${uf ? `, ${uf}` : ""}, Brasil`,
      format: "jsonv2",
      limit: "1",
      countrycodes: "br",
    });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        "User-Agent":
          process.env.GEOCODING_USER_AGENT || "RouteWise/2.0 contact@criarrota.com.br",
        "Accept-Language": "pt-BR",
      },
      signal: controller.signal,
      next: { revalidate: 0 },
    } as RequestInit);
    if (!res.ok) return null;
    const item = (await res.json())[0];
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    return item && isValidCoords(lat, lng)
      ? { lat, lng, displayName: (item.display_name as string | undefined) ?? null }
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function geocodeOrders(orders: OrderRow[], maxNetworkLookups = 100) {
  const cache = new Map<
    string,
    { lat: number; lng: number; displayName?: string | null } | null
  >();
  let lookups = 0;
  for (const order of orders) {
    if (isValidCoords(Number(order.lat), Number(order.lng))) continue;
    const cityNorm = normCity(order.city || "");
    const uf = String(order.uf || "").trim().toUpperCase();
    if (!cityNorm) continue;
    const key = `${uf}|${cityNorm}`;
    if (!cache.has(key)) {
      let found = await findCachedGeocode(cityNorm, uf).catch(() => null);
      if (!found && lookups < maxNetworkLookups) {
        lookups += 1;
        found = await fetchNominatimGeocode(cityNorm, uf);
        await new Promise((r) => setTimeout(r, 1050));
        if (found) {
          await query(
            `INSERT INTO city_geocodes(city_normalized,uf,display_name,lat,lng,source)
             VALUES($1,$2,$3,$4,$5,'nominatim')
             ON CONFLICT(city_normalized,uf) DO UPDATE SET display_name=EXCLUDED.display_name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,verified_at=now()`,
            [cityNorm, uf, found.displayName || null, found.lat, found.lng]
          ).catch(() => {});
        }
      }
      cache.set(key, found);
    }
    const coords = cache.get(key);
    if (coords) {
      order.lat = coords.lat;
      order.lng = coords.lng;
    }
  }
  return orders;
}
