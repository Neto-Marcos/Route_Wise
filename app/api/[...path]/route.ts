import dns from "node:dns";
try {
  dns.setDefaultResultOrder?.("ipv4first");
} catch {}

import { NextRequest, NextResponse } from "next/server";
import {
  hasRouteMinimumException,
  loadActiveRoutingWorkbook,
  requireRoutingDispatcher,
  RoutingError,
  verifyAndSelectRoutingOrders,
} from "@/lib/routing-security";
import { checkOrderMinEligibility } from "@/lib/route-engine";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import webpush from "web-push";
import { audit, db, query } from "@/lib/db";
import { getSession, makeSession, sessionCookie, clearSessionCookie, type UserRole } from "@/lib/auth";
import { uploadUrl, viewUrl } from "@/lib/storage";
import { normalizeDriverPhoto } from "@/lib/driver-photo";
import { BRAZILIAN_HUBS } from "@/lib/geo-brazil";

const geocodeMemoryCache = new Map<string, { items: any[]; ts: number }>();

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
async function body(req: NextRequest) {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data") || ct.includes("application/octet-stream")) {
    return {};
  }
  try {
    return await req.json();
  } catch {
    return {};
  }
}
async function requireRole(role: "dispatcher" | "driver") {
  const s = await getSession(role);
  return s?.role === role ? s : null;
}
function requestedRole(req: NextRequest): "dispatcher" | "driver" {
  return req.headers.get("x-routewise-role") === "driver" ? "driver" : "dispatcher";
}
function routeParts(path: string[]) {
  return path.filter(Boolean);
}

async function notifyOperationOfDeliveredStop({
  companyId,
  routeId,
  routeName,
  stopName,
  driverName,
}: {
  companyId: string;
  routeId: string;
  routeName: string;
  stopName: string;
  driverName: string;
}) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  const subscriptions = await query<{ endpoint: string; p256dh: string; auth: string }>(
    "SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE company_id=$1 AND user_type='dispatcher'",
    [companyId],
  );
  if (!subscriptions.rows.length) return;

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contato@criarrota.com.br", publicKey, privateKey);
  const payload = JSON.stringify({
    title: "Entrega confirmada",
    body: `${driverName} confirmou a entrega em ${stopName} · ${routeName}`.slice(0, 220),
    url: `/`,
  });
  await Promise.all(subscriptions.rows.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        payload,
        { TTL: 60 },
      );
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        await query("DELETE FROM push_subscriptions WHERE endpoint=$1", [subscription.endpoint]);
      }
      console.error("[delivery] Não foi possível enviar push da entrega", error);
    }
  }));
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const p = routeParts((await ctx.params).path);
  try {
    if (p[0] === "health") {
      await query("SELECT 1");
      return json({ status: "healthy" });
    }
    if (p[0] === "osrm") {
      const subpath = p.slice(1).join("/");
      const qs = req.nextUrl.search;
      const targetUrl = `https://router.project-osrm.org/${subpath}${qs}`;
      try {
        const response = await fetch(targetUrl, {
          headers: { "User-Agent": "CriarRota-Proxy/1.0 (https://criarrota.com.br; contato@criarrota.com.br)", Accept: "application/json" },
          signal: AbortSignal.timeout(12000),
        });
        const data = await response.json();
        return json(data, response.ok ? 200 : response.status);
      } catch (err) {
        console.warn("OSRM proxy fetch failed:", err);
        return json({
          code: "NoRoute",
          message: `OSRM proxy indisponível: ${(err as Error).message}`,
          routes: [],
        }, 200);
      }
    }
    if (p[0] === "geocode") {
      const term = String(req.nextUrl.searchParams.get("q") || "").trim();
      if (term.length < 2) return json([]);

      const termNorm = term
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // 1. Cache em memória no processo Node (0ms de latência)
      const cached = geocodeMemoryCache.get(termNorm);
      if (cached && Date.now() - cached.ts < 86400000 && cached.items.length > 0) {
        return json(cached.items);
      }

      const results: Array<{ name: string; address: string; lat: number; lng: number }> = [];
      const seen = new Set<string>();

      const addResult = (name: string, address: string, lat: number, lng: number) => {
        const key = `${Math.round(lat * 100)},${Math.round(lng * 100)}`;
        if (!seen.has(key) && Number.isFinite(lat) && Number.isFinite(lng)) {
          seen.add(key);
          results.push({ name, address, lat, lng });
        }
      };

      // 2. Consulta ultra-rápida no banco de dados local city_geocodes (1ms a 3ms)
      try {
        const dbRes = await query<{ city_normalized: string; uf: string; display_name: string | null; lat: number | string; lng: number | string }>(
          `SELECT city_normalized, uf, display_name, lat, lng
           FROM city_geocodes
           WHERE city_normalized ILIKE $1 OR display_name ILIKE $1
           ORDER BY (city_normalized = $2) DESC, (city_normalized ILIKE $3) DESC, length(city_normalized) ASC
           LIMIT 8`,
          [`%${termNorm}%`, termNorm, `${termNorm}%`]
        );
        for (const r of dbRes.rows) {
          const lat = Number(r.lat);
          const lng = Number(r.lng);
          const name = r.display_name?.split(",")[0] || `${r.city_normalized.toUpperCase()} - ${r.uf}`;
          const address = r.display_name || `${r.city_normalized.toUpperCase()}, ${r.uf}, Brasil`;
          addResult(name, address, lat, lng);
        }
      } catch (dbErr) {
        console.warn("Local DB geocode lookup error:", dbErr);
      }

      // 3. Consulta rápida em memória: BRAZILIAN_HUBS (0.1ms)
      try {
        const termKey = termNorm.replace(/\s+/g, "_");
        for (const [key, hub] of Object.entries(BRAZILIAN_HUBS)) {
          const normHubName = hub.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          if (key.startsWith(termKey) || normHubName.startsWith(termNorm) || key.includes(termKey)) {
            addResult(hub.name, `${hub.name}, ${hub.uf}, Brasil`, hub.lat, hub.lng);
            if (results.length >= 6) break;
          }
        }
      } catch (err) {
        console.warn("Hub fast lookup error:", err);
      }

      // Se já encontrou resultados locais, retorne imediatamente em < 5ms!
      if (results.length >= 2) {
        geocodeMemoryCache.set(termNorm, { items: results, ts: Date.now() });
        return json(results);
      }

      // 4. Apenas se não houver resultados locais suficientes, consulta Nominatim com timeout curto (2500ms)
      try {
        const search = new URLSearchParams({
          format: "jsonv2",
          limit: "6",
          countrycodes: "br",
          addressdetails: "1",
          q: term,
        });

        const response = await fetch(`https://nominatim.openstreetmap.org/search?${search}`, {
          headers: {
            "User-Agent": "CriarRota/1.0 (https://criarrota.com.br; contato@criarrota.com.br)",
            Accept: "application/json",
            "Accept-Language": "pt-BR,pt;q=0.9",
          },
          signal: AbortSignal.timeout(2500),
          next: { revalidate: 3600 },
        });

        if (response.ok) {
          const data = await response.json();
          const items = (Array.isArray(data) ? data : [])
            .map((item: any) => ({
              name: item.name || String(item.display_name || "").split(",")[0],
              address: item.display_name || item.name || term,
              lat: Number(item.lat),
              lng: Number(item.lon),
            }))
            .filter((item: any) => Number.isFinite(item.lat) && Number.isFinite(item.lng));

          for (const it of items) {
            addResult(it.name, it.address, it.lat, it.lng);

            // Grava no banco local city_geocodes para NUNCA mais precisar chamar o Nominatim para esta cidade
            const [cityName] = it.address.split(",");
            const cityNormPart = cityName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
            query(
              `INSERT INTO city_geocodes(city_normalized, uf, display_name, lat, lng, source)
               VALUES($1, 'BR', $2, $3, $4, 'nominatim')
               ON CONFLICT(city_normalized, uf) DO UPDATE
               SET display_name=EXCLUDED.display_name, lat=EXCLUDED.lat, lng=EXCLUDED.lng, verified_at=now()`,
              [cityNormPart, it.address, it.lat, it.lng]
            ).catch(() => {});
          }
        }
      } catch (err) {
        console.warn("Nominatim geocode warning:", (err as Error).message);
      }

      // Salva no cache de memória
      if (results.length > 0) {
        geocodeMemoryCache.set(termNorm, { items: results, ts: Date.now() });
      }

      return json(results);
    }
    if (p[0] === "stations") {
      try {
        const response = await fetch(
          "https://mapa-efleet.justit.cloud/ws/api.php",
          {
            headers: { Operacao: "ViewStations", Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
            next: { revalidate: 600 },
          },
        );
        if (!response.ok) throw new Error("Rede de postos indisponível");
        const data = await response.json();
        if (!Array.isArray(data) || !data.length) throw new Error("Resposta inválida da rede de postos");
        return json(data);
      } catch (err) {
        console.warn("Stations fetch failed:", err);
        return json({ error: "A rede eFleet está indisponível no momento. Tente novamente mais tarde.", stations: [] }, 200);
      }
    }
    if (p[0] === "road-places") {
      const rawCoords = req.nextUrl.searchParams.get("coords") || "";
      const points = rawCoords
        .split(";")
        .map((value) => value.split(",").map(Number))
        .filter((value): value is [number, number] =>
          value.length === 2 && value.every(Number.isFinite),
        )
        .slice(0, 24);
      if (!points.length) return json([]);

      const lats = points.map(([lat]) => lat);
      const lngs = points.map(([, lng]) => lng);
      const padding = 0.16;
      const south = Math.max(-90, Math.min(...lats) - padding);
      const west = Math.max(-180, Math.min(...lngs) - padding);
      const north = Math.min(90, Math.max(...lats) + padding);
      const east = Math.min(180, Math.max(...lngs) + padding);
      const viewbox = `${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)},${south.toFixed(5)}`;
      try {
        const places: Array<Record<string, unknown>> = [];
        for (const [queryText, kind] of [["restaurant", "restaurant"], ["hotel pousada", "lodging"]] as const) {
          const search = new URLSearchParams({
            format: "jsonv2",
            q: queryText,
            viewbox,
            bounded: "1",
            limit: "30",
            addressdetails: "1",
          });
          const response = await fetch(`https://nominatim.openstreetmap.org/search?${search}`, {
            headers: {
              "User-Agent": "CriarRota/1.0 (https://criarrota.com.br; contato@criarrota.com.br)",
              Accept: "application/json",
              "Accept-Language": "pt-BR,pt;q=0.9",
            },
            signal: AbortSignal.timeout(10000),
            next: { revalidate: 3600 },
          });
          if (!response.ok) throw new Error(`Busca de locais respondeu ${response.status}`);
          const data = await response.json();
          for (const element of Array.isArray(data) ? data : []) {
            const lat = Number(element.lat);
            const lng = Number(element.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
            const label = String(element.display_name || "");
            const name = String(element.name || label.split(",")[0] || (kind === "restaurant" ? "Restaurante" : "Hospedagem"));
            places.push({
              id: `osm-${element.osm_type}-${element.osm_id}-${kind}`,
              name,
              kind,
              lat,
              lng,
              address: label.split(",").slice(1, 4).join(",").trim(),
              openingHours: "",
              parking: false,
            });
          }
          // Respeita o limite público de uma requisição por segundo do Nominatim.
          if (kind === "restaurant") await new Promise((resolveDelay) => setTimeout(resolveDelay, 1050));
        }
        return json(places);
      } catch (err) {
        console.warn("Road places fetch failed:", err);
        return json([]);
      }
    }
    if (p[0] === "uploads" && p[1] === "local") {
      const rawKey = p.slice(2).join("/");
      const key = decodeURIComponent(rawKey);

      // 1. Check PostgreSQL upload_objects database first (resilient against container restarts)
      try {
        const { rows } = await query(
          "SELECT content_type, file_data FROM upload_objects WHERE object_key=$1",
          [key],
        );
        if (rows[0]?.file_data) {
          const buf = Buffer.isBuffer(rows[0].file_data)
            ? rows[0].file_data
            : Buffer.from(rows[0].file_data);
          return new NextResponse(buf, {
            headers: {
              "Content-Type": rows[0].content_type || "image/jpeg",
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      } catch (dbErr) {
        console.warn("DB upload fetch notice:", dbErr);
      }

      // 2. Fallback to filesystem if present
      const safeName = encodeURIComponent(key);
      const candidates = [
        resolve(process.cwd(), ".local-db", "uploads", safeName),
        resolve("/tmp", "uploads", safeName),
      ];
      for (const filePath of candidates) {
        if (existsSync(filePath)) {
          const fileData = await readFile(filePath);
          const { rows } = await query(
            "SELECT content_type FROM upload_objects WHERE object_key=$1",
            [key],
          );
          const ct = rows[0]?.content_type || "image/jpeg";
          return new NextResponse(fileData, {
            headers: {
              "Content-Type": ct,
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }
      return json({ error: "Arquivo não encontrado" }, 404);
    }
    if (p[0] === "session" && p[1] === "me") {
      const session = await getSession(requestedRole(req));
      if (!session) return json({ authenticated: false }, 200);
      let companyCode = "";
      let companyName = "";
      let userRole: UserRole = session.userRole || (session.role === "driver" ? "driver" : "admin");
      let userName = "";
      if (session.companyId) {
        const comp = await query("SELECT code, name FROM companies WHERE id=$1", [session.companyId]);
        if (comp.rows[0]) {
          companyCode = comp.rows[0].code;
          companyName = comp.rows[0].name;
        }
      }
      if (session.dispatcherId) {
        const disp = await query("SELECT name, role FROM dispatchers WHERE id=$1", [session.dispatcherId]);
        if (disp.rows[0]) {
          userName = disp.rows[0].name;
          if (disp.rows[0].role) userRole = disp.rows[0].role as UserRole;
        }
      } else if (session.driverId) {
        const drv = await query("SELECT name FROM drivers WHERE id=$1", [session.driverId]);
        if (drv.rows[0]) {
          userName = drv.rows[0].name;
        }
      }
      return json({
        authenticated: true,
        role: session.role,
        userRole,
        userName,
        companyId: session.companyId,
        companyCode,
        companyName,
        dispatcherId: session.dispatcherId,
        driverId: session.driverId,
      });
    }
    if (p[0] === "companies" && p.length === 1) {
      const session = await getSession(requestedRole(req));
      if (!session || session.role !== "dispatcher") return json({ error: "Acesso restrito" }, 403);
      // Apenas o Administrador Supremo pode visualizar e navegar por todas as empresas
      if (session.userRole !== "superadmin") {
        const { rows } = await query(
          "SELECT id, code, name, active, created_at FROM companies WHERE id=$1 ORDER BY name ASC",
          [session.companyId],
        );
        return json(rows);
      }
      const { rows } = await query(
        "SELECT id, code, name, active, created_at FROM companies ORDER BY active DESC, name ASC"
      );
      return json(rows);
    }
    if (p[0] === "dispatchers" && p.length === 1) {
      const session = await getSession(requestedRole(req));
      if (!session || session.role !== "dispatcher") return json({ error: "Acesso restrito" }, 403);
      const { rows } = await query(
        "SELECT id, name, email, COALESCE(role, 'admin') as role, active, created_at FROM dispatchers WHERE company_id=$1 ORDER BY active DESC, created_at ASC",
        [session.companyId],
      );
      return json(rows);
    }
    if (p[0] === "drivers" && p.length === 1) {
      const sp = req.nextUrl.searchParams;
      const all = sp.get("all") === "true";
      const session = await getSession(requestedRole(req));
      const requestedCompanyCode = sp.get("company")?.trim();
      // A tela de motorista é uma descoberta pública: o código digitado deve
      // prevalecer sobre qualquer cookie antigo de outro motorista no aparelho.
      let companyId: string | undefined;
      if (requestedCompanyCode) {
        const company = await query("SELECT id FROM companies WHERE code=upper($1) AND active=true", [requestedCompanyCode]);
        companyId = company.rows[0]?.id;
      } else {
        companyId = session?.companyId;
      }
      if (!companyId) return json({ error: "Informe o código da empresa" }, 400);
      const showAll = all && session?.role === "dispatcher";
      const { rows } = await query(
        `SELECT id,public_id,name,phone,photo,active,created_at FROM drivers WHERE company_id=$1 ${showAll ? "" : "AND active=true"} ORDER BY active DESC, name ASC`,
        [companyId],
      );
      return NextResponse.json(rows, { headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" } });
    }
    const session = await getSession(requestedRole(req));

    if (p[0] === "vehicles" && p.length === 1) {
      if (!session) return json({ error: "Sessão necessária" }, 401);
      const showAll = session?.role === "dispatcher";
      const { rows } = await query(
        `SELECT id,name,plate,current_odometer,rate_per_km,active,created_at FROM vehicles WHERE company_id=$1 ${showAll ? "" : "AND active=true"} ORDER BY active DESC,name ASC`,
        [session.companyId],
      );
      return json(rows);
    }
    if (!session) return json({ error: "Sessão necessária" }, 401);
    if (p[0] === "routes" && p.length === 1) {
      const conditions: string[] = [];
      const values: unknown[] = [session.companyId];
      conditions.push("r.company_id=$1");
      if (session.role === "driver") {
        values.push(session.driverId);
        conditions.push(`r.driver_id=$${values.length}`);
      } else {
        const sp = req.nextUrl.searchParams;
        const status = sp.get("status");
        const driverId = sp.get("driver_id");
        const date = sp.get("date");
        const search = sp.get("search")?.trim();
        if (status && status !== "all") {
          values.push(status);
          conditions.push(`r.status=$${values.length}`);
        } else {
          // Rotas canceladas permanecem no banco para auditoria, mas não ocupam
          // o histórico operacional padrão.
          conditions.push("r.status <> 'cancelled'");
        }
        if (driverId && driverId !== "all") {
          values.push(driverId);
          conditions.push(`r.driver_id=$${values.length}`);
        }
        if (date) {
          values.push(date);
          conditions.push(`r.route_date=$${values.length}`);
        }
        if (search) {
          values.push(`%${search}%`);
          const idx = values.length;
          conditions.push(`(r.name ILIKE $${idx} OR d.name ILIKE $${idx} OR v.name ILIKE $${idx} OR v.plate ILIKE $${idx})`);
        }
      }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await query(
        `SELECT r.*, to_char(r.route_date, 'YYYY-MM-DD') route_date, d.name driver_name,v.name vehicle_name,v.plate,v.current_odometer vehicle_odometer,
        (SELECT count(*) FROM route_stops s WHERE s.route_id=r.id AND NOT s.is_origin AND s.position > 0) deliveries,
        (SELECT count(*) FROM route_stops s WHERE s.route_id=r.id AND s.status='delivered' AND NOT s.is_origin AND s.position > 0) delivered,
        (SELECT json_build_object('lat',l.lat,'lng',l.lng,'recorded_at',l.recorded_at) FROM location_points l WHERE l.route_id=r.id ORDER BY l.recorded_at DESC LIMIT 1) last_location
        FROM routes r
        LEFT JOIN drivers d ON d.id=r.driver_id
        LEFT JOIN vehicles v ON v.id=r.vehicle_id
        ${where}
        ORDER BY r.route_date DESC,r.created_at DESC`,
        values,
      );
      const normalizedRoutes = rows.map((r: any) => ({
        ...r,
        deliveries: Number(r.deliveries || 0),
        delivered: Number(r.delivered || 0),
        route_date: r.route_date ? String(r.route_date).slice(0, 10) : "",
      }));
      return json(normalizedRoutes);
    }
    if (p[0] === "routes" && p[1]) {
      const { rows } = await query(
        `SELECT r.*, to_char(r.route_date, 'YYYY-MM-DD') route_date, d.name driver_name,v.name vehicle_name,v.plate,v.current_odometer vehicle_odometer,
        (SELECT count(*) FROM route_stops s WHERE s.route_id=r.id AND NOT s.is_origin AND s.position > 0) deliveries,
        (SELECT count(*) FROM route_stops s WHERE s.route_id=r.id AND s.status='delivered' AND NOT s.is_origin AND s.position > 0) delivered
        FROM routes r LEFT JOIN drivers d ON d.id=r.driver_id LEFT JOIN vehicles v ON v.id=r.vehicle_id WHERE (r.id::text=$1 OR r.public_id::text=$1) AND r.company_id=$2`,
        [p[1], session.companyId],
      );
      if (!rows[0]) return json({ error: "Rota não encontrada" }, 404);
      const route = rows[0] as Record<string, unknown>;
      if (session.role === "driver" && route.driver_id !== session.driverId)
        return json({ error: "Acesso restrito" }, 403);
      const stops = await query(
        "SELECT * FROM route_stops WHERE route_id=$1 ORDER BY position",
        [route.id],
      );
      const deliveryStops = stops.rows.filter((s: any) => !s.is_origin && s.position > 0);
      const deliveredStops = deliveryStops.filter((s: any) => s.status === "delivered");
      route.deliveries = Number(route.deliveries ?? deliveryStops.length);
      route.delivered = Number(route.delivered ?? deliveredStops.length);
      route.route_date = route.route_date ? String(route.route_date).slice(0, 10) : "";
      const odometer = await query(
        "SELECT phase,kilometers,photo_key,lat,lng,recorded_at FROM odometer_readings WHERE route_id=$1 ORDER BY recorded_at ASC",
        [route.id],
      );
      const odomWithUrls = await Promise.all(
        odometer.rows.map(async (o: any) => ({
          ...o,
          photo_url: o.photo_key ? await viewUrl(o.photo_key) : null,
        })),
      );
      const events = await query(
        `SELECT de.id,de.operation_id,de.stop_id,de.photo_key,de.note,de.lat,de.lng,de.delivered_at,
        rs.name stop_name,rs.position stop_position,rs.address stop_address
        FROM delivery_events de
        JOIN route_stops rs ON rs.id=de.stop_id
        WHERE de.route_id=$1
        ORDER BY de.delivered_at ASC`,
        [route.id],
      );
      const eventsWithUrls = await Promise.all(
        events.rows.map(async (ev: any) => ({
          ...ev,
          photo_url: ev.photo_key ? await viewUrl(ev.photo_key) : null,
        })),
      );
      const locationPoints = await query(
        "SELECT lat,lng,recorded_at,accuracy FROM location_points WHERE route_id=$1 ORDER BY recorded_at ASC",
        [route.id],
      );
      return json({
        ...route,
        route_date: route.route_date ? String(route.route_date).slice(0, 10) : "",
        stops: stops.rows,
        odometer: odomWithUrls,
        delivery_events: eventsWithUrls,
        location_points: locationPoints.rows,
      });
    }
    return json({ error: "Não encontrado" }, 404);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Erro interno" },
      500,
    );
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const p = routeParts((await ctx.params).path);
  const data = await body(req);
  try {
    if (p.join("/") === "companies/register") {
      const session = await getSession(requestedRole(req));
      if (!session || session.userRole !== "superadmin") {
        return json({ error: "Apenas o Administrador Supremo pode cadastrar novas empresas e filiais." }, 403);
      }
      const code = String(data.companyCode || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      if (code.length < 3 || !email.includes("@") || password.length < 6 || !String(data.companyName || "").trim())
        return json({ error: "Preencha empresa, código, e-mail e senha de ao menos 6 caracteres" }, 400);
      const existing = await query("SELECT id FROM companies WHERE code=$1", [code]);
      if (existing.rows.length > 0) {
        return json({ error: `Já existe uma empresa cadastrada com o código "${code}". Utilize a opção "Já tenho uma empresa" para entrar ou escolha outro código.` }, 409);
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const company = await client.query("INSERT INTO companies(code,name) VALUES($1,$2) RETURNING id,code,name", [code, String(data.companyName).trim()]);
        const dispatcher = await client.query("INSERT INTO dispatchers(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,'admin') RETURNING id,role", [company.rows[0].id, String(data.name || "Administrador").trim(), email, await hash(password, 10)]);
        await client.query("COMMIT");
        const res = json({ ok: true, company: company.rows[0], userRole: "admin" }, 201);
        res.cookies.set(sessionCookie(await makeSession({ role: "dispatcher", userRole: "admin", companyId: company.rows[0].id, dispatcherId: dispatcher.rows[0].id }), "dispatcher"));
        return res;
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }
    if (p.join("/") === "session/dispatcher") {
      const companyCode = String(data.companyCode || "").trim().toUpperCase();
      const email = String(data.email || "").trim().toLowerCase();
      const expectedRole = data.expectedRole ? String(data.expectedRole).trim() : null;

      // Autenticação pelo código da empresa e e-mail/usuário
      const { rows } = await query(
        "SELECT u.id,u.company_id,u.password_hash,COALESCE(u.role,'admin') as role,c.name company_name,c.code company_code FROM dispatchers u JOIN companies c ON c.id=u.company_id WHERE (c.code=$1 OR ($1='EU' AND c.code='EU')) AND (lower(u.email)=$2 OR lower(u.name)=$2) AND u.active=true AND c.active=true",
        [companyCode, email],
      );
      if (!rows[0] || !(await compare(String(data.password || ""), rows[0].password_hash))) {
        return json({ error: "Empresa, usuário/e-mail ou senha inválidos" }, 401);
      }
      const userRole = (rows[0].role || "admin") as UserRole;

      // Validação amigável se tentou logar por um portal diferente do seu perfil cadastrado
      if (expectedRole && expectedRole !== "admin" && userRole !== "superadmin" && userRole !== "admin" && userRole !== expectedRole) {
        const roleLabels: Record<string, string> = {
          superadmin: "Administrador Supremo",
          admin: "Administrador da Empresa",
          route_creator: "Criador de rotas",
          office: "Escritório",
          driver: "Motorista",
        };
        return json({ error: `Este usuário está cadastrado como "${roleLabels[userRole] || userRole}". Por favor, utilize a opção correta na tela inicial.` }, 403);
      }

      const res = json({ ok: true, companyName: rows[0].company_name, userRole });
      res.cookies.set(sessionCookie(await makeSession({ role: "dispatcher", userRole, companyId: rows[0].company_id, dispatcherId: rows[0].id }), "dispatcher"));
      return res;
    }
    if (p.join("/") === "session/driver") {
      const companyCode = String(data.companyCode || "").trim().toUpperCase();
      const driverId = String(data.driverId || "").trim();
      const { rows } = await query(
        companyCode
          ? "SELECT d.id,d.pin_hash,d.company_id FROM drivers d JOIN companies c ON c.id=d.company_id WHERE (d.id::text=$1 OR d.public_id::text=$1) AND c.code=$2 AND d.active=true AND c.active=true"
          : "SELECT d.id,d.pin_hash,d.company_id FROM drivers d WHERE (d.id::text=$1 OR d.public_id::text=$1) AND d.active=true",
        companyCode ? [driverId, companyCode] : [driverId],
      );
      if (!rows[0]) return json({ error: "Motorista inválido" }, 400);
      if (!(await compare(String(data.password || ""), rows[0].pin_hash)))
        return json({ error: "Senha incorreta" }, 401);
      const res = json({ ok: true, userRole: "driver" });
      res.cookies.set(
        sessionCookie(
          await makeSession({ role: "driver", userRole: "driver", driverId: rows[0].id, companyId: rows[0].company_id }),
          "driver",
        ),
      );
      return res;
    }
    if (p.join("/") === "session/change-password") {
      const session = await getSession(requestedRole(req));
      if (!session) return json({ error: "Sessão não encontrada" }, 401);

      const currentPassword = String(data.currentPassword || "");
      const newPassword = String(data.newPassword || "");

      if (!currentPassword || !newPassword) {
        return json({ error: "Informe a senha atual e a nova senha." }, 400);
      }

      if (session.role === "driver") {
        if (!/^\d{4,8}$/.test(newPassword)) {
          return json({ error: "A nova senha do motorista deve ser numérica de 4 a 8 dígitos." }, 400);
        }
        const { rows } = await query("SELECT pin_hash FROM drivers WHERE id=$1", [session.driverId]);
        if (!rows[0] || !(await compare(currentPassword, rows[0].pin_hash))) {
          return json({ error: "Senha atual incorreta." }, 400);
        }
        const newHash = await hash(newPassword, 10);
        await query("UPDATE drivers SET pin_hash=$1 WHERE id=$2", [newHash, session.driverId]);
        await audit("driver", session.driverId || null, "change_password", "driver", session.driverId || null);

        const res = json({ ok: true, message: "Senha alterada com sucesso! Você foi desconectado." });
        res.cookies.set(clearSessionCookie("driver"));
        return res;
      } else {
        if (newPassword.length < 6) {
          return json({ error: "A nova senha deve possuir no mínimo 6 caracteres." }, 400);
        }
        const { rows } = await query("SELECT password_hash FROM dispatchers WHERE id=$1", [session.dispatcherId]);
        if (!rows[0] || !(await compare(currentPassword, rows[0].password_hash))) {
          return json({ error: "Senha atual incorreta." }, 400);
        }
        const newHash = await hash(newPassword, 10);
        await query("UPDATE dispatchers SET password_hash=$1 WHERE id=$2", [newHash, session.dispatcherId]);
        await audit("dispatcher", session.dispatcherId || null, "change_password", "dispatcher", session.dispatcherId || null);

        const res = json({ ok: true, message: "Senha alterada com sucesso! Você foi desconectado." });
        res.cookies.set(clearSessionCookie("dispatcher"));
        return res;
      }
    }
    if (p.join("/") === "session/logout") {
      const res = json({ ok: true });
      res.cookies.set(clearSessionCookie("dispatcher"));
      res.cookies.set(clearSessionCookie("driver"));
      return res;
    }
    if (p[0] === "uploads" && p[1] === "presign") {
      const s = await getSession(requestedRole(req));
      if (!s) return json({ error: "Sessão necessária" }, 401);
      const ct = String(data.contentType || "").toLowerCase();
      if (!ct.startsWith("image/") && ct !== "application/octet-stream")
        return json({ error: "Formato de foto inválido. Envie uma imagem." }, 400);
      const contentType = ct.startsWith("image/") ? ct : "image/jpeg";
      const key = `${data.kind || "proof"}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
      await query(
        "INSERT INTO upload_objects(object_key,kind,content_type,size_bytes) VALUES($1,$2,$3,$4)",
        [key, data.kind || "proof", contentType, data.size || null],
      );
      return json({ key, url: await uploadUrl(key, contentType) });
    }
    if (p[0] === "uploads" && p[1] === "direct") {
      const s = await getSession(requestedRole(req));
      if (!s) return json({ error: "Sessão necessária" }, 401);

      let kind = "proof";
      let contentType = "image/jpeg";
      let buf: Buffer | null = null;

      if (req.headers.get("content-type")?.includes("multipart/form-data")) {
        try {
          const form = await req.formData();
          const file = form.get("file") as File | null;
          kind = String(form.get("kind") || "proof");
          if (file) {
            contentType = file.type || "image/jpeg";
            buf = Buffer.from(await file.arrayBuffer());
          }
        } catch (fErr) {
          console.warn("FormData parse failed:", fErr);
        }
      }

      if (!buf && data.base64) {
        kind = String(data.kind || "proof");
        contentType = String(data.contentType || "image/jpeg");
        const cleanB64 = String(data.base64).replace(/^data:image\/\w+;base64,/, "");
        buf = Buffer.from(cleanB64, "base64");
      }

      if (!buf || buf.length === 0) {
        return json({ error: "Foto não fornecida ou vazia" }, 400);
      }

      const key = `${kind}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}`;
      await query(
        "INSERT INTO upload_objects(object_key,kind,content_type,size_bytes,file_data) VALUES($1,$2,$3,$4,$5)",
        [key, kind, contentType, buf.length, buf],
      );

      // Best effort disk cache
      try {
        const safeName = encodeURIComponent(key);
        const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
        await mkdir(uploadDir, { recursive: true });
        await writeFile(resolve(uploadDir, safeName), buf);
      } catch {
        try {
          const safeName = encodeURIComponent(key);
          const tmpDir = resolve("/tmp", "uploads");
          await mkdir(tmpDir, { recursive: true });
          await writeFile(resolve(tmpDir, safeName), buf);
        } catch {}
      }

      return json({ key, url: `/api/uploads/local/${encodeURIComponent(key)}` });
    }

    if (p[0] === "admin" && p[1] === "reset-data")
      return json({ error: "Operação de reset desativada" }, 403);

    const session = await getSession(requestedRole(req));

    const isDispatcher = session?.role === "dispatcher";

    if (!session && !isDispatcher) return json({ error: "Sessão necessária" }, 401);
    // Check ownership before handling GPS, odometer or photos. In particular,
    // a signed driver session is not authorization for an arbitrary route ID.
    if (session?.role === "driver" && p[0] === "routes" && p[1]) {
      const owned = await query(
        "SELECT r.id FROM routes r JOIN drivers d ON d.id=r.driver_id AND d.active JOIN companies c ON c.id=r.company_id AND c.active WHERE r.id::text=$1 AND r.company_id=$2 AND r.driver_id=$3",
        [p[1], session.companyId, session.driverId],
      );
      if (!owned.rows[0]) return json({ error: "Rota não encontrada" }, 404);
      if (["stops", "deliveries"].includes(p[2]) && p[3]) {
        const stop = await query("SELECT id FROM route_stops WHERE id::text=$1 AND route_id=$2 AND NOT is_origin", [p[3], owned.rows[0].id]);
        if (!stop.rows[0]) return json({ error: "Parada não encontrada" }, 404);
      }
    }
    if (p[0] === "companies" && p[1] === "switch" && isDispatcher) {
      if (session?.userRole !== "superadmin") {
        return json({ error: "Apenas o Administrador Supremo pode alternar entre empresas" }, 403);
      }
      const companyId = String(data.companyId || "").trim();
      if (!companyId) return json({ error: "Empresa não informada" }, 400);
      const comp = await query("SELECT id, code, name FROM companies WHERE id=$1 AND active=true", [companyId]);
      if (!comp.rows[0]) return json({ error: "Empresa não encontrada" }, 404);
      const res = json({ ok: true, company: comp.rows[0] });
      res.cookies.set(sessionCookie(await makeSession({
        role: "dispatcher",
        userRole: "superadmin",
        companyId: comp.rows[0].id,
        dispatcherId: session!.dispatcherId
      }), "dispatcher"));
      return res;
    }
    if (p[0] === "dispatchers" && isDispatcher) {
      if (session?.userRole !== "admin" && session?.userRole !== "superadmin") {
        return json({ error: "Apenas administradores podem cadastrar novos usuários" }, 403);
      }
      const name = String(data.name || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      const role = data.role && ["admin", "route_creator", "office"].includes(data.role) ? data.role : "route_creator";
      if (!name || !email.includes("@") || password.length < 6)
        return json({ error: "Preencha nome, e-mail válido e senha com no mínimo 6 caracteres" }, 400);

      const existing = await query(
        "SELECT 1 FROM dispatchers WHERE company_id=$1 AND lower(email)=$2",
        [session!.companyId, email],
      );
      if (existing.rows[0])
        return json({ error: "Já existe um usuário com este e-mail nesta empresa" }, 409);

      const { rows } = await query(
        "INSERT INTO dispatchers(company_id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,active,created_at",
        [session!.companyId, name, email, await hash(password, 10), role],
      );
      await audit("dispatcher", session!.dispatcherId || null, "create", "dispatcher", rows[0].id);
      return json(rows[0], 201);
    }
    let targetCompanyId = session?.companyId;
    if (targetCompanyId) {
      const chk = await query("SELECT id FROM companies WHERE id=$1 AND active=true", [targetCompanyId]);
      if (!chk.rows[0]) {
        return json({ error: "Empresa da sessão inativa ou não encontrada" }, 401);
      }
    }

    if (p[0] === "drivers" && isDispatcher) {
      let photo;
      try { photo = await normalizeDriverPhoto(data.photo); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
      if (!/^\d{4,8}$/.test(String(data.password || "")))
        return json({ error: "Defina uma senha numérica de 4 a 8 dígitos" }, 400);
      const { rows } = await query(
        "INSERT INTO drivers(company_id,name,phone,pin_hash,photo) VALUES($1,$2,$3,$4,$5) RETURNING id,public_id,name,phone,photo,active",
        [targetCompanyId, data.name, data.phone || null, await hash(String(data.password), 10), photo],
      );
      await audit("dispatcher", null, "create", "driver", rows[0].id);
      return json(rows[0], 201);
    }
    if (p[0] === "vehicles" && isDispatcher) {
      const plate = String(data.plate || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const ratePerKm = data.rate_per_km !== undefined && data.rate_per_km !== null && data.rate_per_km !== "" ? Number(data.rate_per_km) : null;
      const { rows } = await query(
        "INSERT INTO vehicles(company_id,name,plate,current_odometer,rate_per_km) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [targetCompanyId, data.name, plate, Number(data.odometer || 0), ratePerKm],
      );
      await audit("dispatcher", null, "create", "vehicle", rows[0].id);
      return json(rows[0], 201);
    }
    if (p[0] === "routes" && p.length === 1 && isDispatcher) {
      const orderIds = Array.isArray(data.stops) ? data.stops.flatMap((s: any) => s.order_ids || []) : [];
      if (orderIds.length) {
        try {
          await requireRoutingDispatcher({ query }, session);
          const wb = await loadActiveRoutingWorkbook({ query }, session!.companyId!);
          if ((await verifyAndSelectRoutingOrders({ query }, session!.companyId!, wb, orderIds)).some((o) => !checkOrderMinEligibility(o).eligible)) {
            return json({ error: "Pedido abaixo do mínimo exige transferência autorizada pelo roteirizador." }, 428);
          }
        } catch (err) {
          if (err instanceof RoutingError) return json({ error: err.message }, err.status);
          throw err;
        }
      }
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const isAssigned = !!(data.driverId && data.vehicleId);
        const rr = await client.query(
          "INSERT INTO routes(company_id,name,route_date,optimize_by,circular,estimated_km,driver_id,vehicle_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            targetCompanyId,
            data.name,
            data.routeDate,
            data.optimizeBy || "distance",
            !!data.circular,
            data.estimatedKm || null,
            data.driverId || null,
            data.vehicleId || null,
            isAssigned ? "assigned" : "draft",
          ],
        );
        for (let i = 0; i < data.stops.length; i++) {
          const s = data.stops[i];
          const boxes = s.boxes ? Number(s.boxes) : null;
          const volume = s.volume_m3 ? Number(s.volume_m3) : null;
          await client.query(
            "INSERT INTO route_stops(route_id,position,name,address,lat,lng,is_origin,boxes,volume_m3) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [rr.rows[0].id, i, s.name, s.address, s.lat, s.lng, i === 0, boxes, volume],
          );
        }
        await client.query("COMMIT");
        return json(rr.rows[0], 201);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    if (
      p[0] === "routes" &&
      p[2] === "assign" &&
      isDispatcher
    ) {
      if (await hasRouteMinimumException({ query }, p[1], session!.companyId!)) {
        return json({ error: "Rota com exceção auditada: nova autorização necessária para reatribuir." }, 409);
      }
      const { rows } = await query(
        "UPDATE routes SET driver_id=$2,vehicle_id=$3,status='assigned' WHERE id=$1 AND company_id=$4 AND status IN ('draft','assigned') AND EXISTS(SELECT 1 FROM drivers WHERE id=$2 AND company_id=$4 AND active=true) AND EXISTS(SELECT 1 FROM vehicles WHERE id=$3 AND company_id=$4 AND active=true) RETURNING public_id",
        [p[1], data.driverId, data.vehicleId, session!.companyId],
      );
      if (!rows[0])
        return json({ error: "Rota ativa não pode ser alterada" }, 409);
      await audit("dispatcher", null, "assign", "route", p[1], data);
      return json(rows[0]);
    }
    if (
      p[0] === "routes" &&
      p[2] === "cancel" &&
      (session?.role === "dispatcher" || isDispatcher)
    ) {
      const { rows } = await query(
        "UPDATE routes SET status='cancelled',finished_at=now() WHERE id=$1 AND company_id=$2 AND status IN ('draft','assigned','active') RETURNING id",
        [p[1], session!.companyId],
      );
      if (!rows[0]) return json({ error: "Esta rota não pode ser cancelada" }, 409);
      await audit("dispatcher", null, "cancel", "route", p[1]);
      return json({ ok: true });
    }
    if (p[0] === "routes" && p[2] === "start" && session && session.role === "driver") {
      let photoKey = data.photoKey;
      if (!photoKey && data.photoBase64) {
        const ext = String(data.photoContentType || "").includes("webp") ? "webp" : "jpg";
        const opId = data.operationId || randomUUID();
        photoKey = `start/${opId}.${ext}`;
        const buf = Buffer.from(data.photoBase64, "base64");
        const ct = data.photoContentType || (ext === "webp" ? "image/webp" : "image/jpeg");
        await query(
          "INSERT INTO upload_objects(object_key,kind,content_type,size_bytes,file_data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(object_key) DO UPDATE SET file_data=EXCLUDED.file_data, size_bytes=EXCLUDED.size_bytes",
          [photoKey, "start", ct, buf.byteLength, buf],
        );
        try {
          const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
          await mkdir(uploadDir, { recursive: true });
          await writeFile(resolve(uploadDir, encodeURIComponent(photoKey)), buf);
        } catch {}
      }
      if (photoKey && data.photoBase64) {
        try {
          const buf = Buffer.from(data.photoBase64, "base64");
          await query(
            "UPDATE upload_objects SET file_data=COALESCE(file_data, $1), size_bytes=COALESCE(size_bytes, $2) WHERE object_key=$3",
            [buf, buf.byteLength, photoKey],
          );
        } catch {}
      }
      if (!photoKey || !Number.isFinite(Number(data.kilometers)))
        return json({ error: "Quilometragem e foto são obrigatórias" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query(
          "UPDATE routes SET status='active',started_at=now() WHERE id=$1 AND driver_id=$2 AND status='assigned' RETURNING vehicle_id",
          [p[1], session.driverId],
        );
        if (!r.rows[0]) {
          const existing = await client.query(
            "SELECT 1 FROM routes WHERE id=$1 AND driver_id=$2 AND status IN ('active', 'completed')",
            [p[1], session.driverId],
          );
          if (existing.rows[0]) {
            await client.query("COMMIT");
            return json({ ok: true, message: "Rota já em andamento", photoKey });
          }
          throw new Error("Rota não pode ser iniciada");
        }
        const v = await client.query(
          "SELECT current_odometer FROM vehicles WHERE id=$1 FOR UPDATE",
          [r.rows[0].vehicle_id],
        );
        const prevOdo = Number(v.rows[0]?.current_odometer || 0);
        if (Number(data.kilometers) < prevOdo)
          throw new Error(`Quilometragem informada (${data.kilometers} km) é menor que o odômetro anterior do veículo (${prevOdo} km). Insira a quilometragem atual do painel.`);
        await client.query(
          "INSERT INTO odometer_readings(route_id,phase,kilometers,photo_key,lat,lng) VALUES($1,'start',$2,$3,$4,$5) ON CONFLICT (route_id, phase) DO UPDATE SET kilometers=EXCLUDED.kilometers, photo_key=EXCLUDED.photo_key, lat=EXCLUDED.lat, lng=EXCLUDED.lng",
          [p[1], data.kilometers, photoKey, data.lat, data.lng],
        );
        await client.query("COMMIT");
        await audit("driver", session.driverId || null, "start", "route", p[1]);
        return json({ ok: true, photoKey });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    if (
      p[0] === "routes" &&
      p[2] === "deliveries" &&
      p[4] === "complete" &&
      session &&
      session.role === "driver"
    ) {
      // Support both a single photo and an array of photos
      const rawPhotos: Array<{
        operationId: string;
        photoKey?: string;
        photoBase64?: string;
        photoContentType?: string;
        note?: string;
      }> = Array.isArray(data.photos) && data.photos.length > 0
        ? data.photos
        : [
            {
              operationId: data.operationId,
              photoKey: data.photoKey,
              photoBase64: data.photoBase64,
              photoContentType: data.photoContentType,
              note: data.note,
            },
          ];

      for (const item of rawPhotos) {
        if (!item.photoKey && item.photoBase64) {
          const ext = String(item.photoContentType || "").includes("webp") ? "webp" : "jpg";
          const opId = item.operationId || randomUUID();
          item.photoKey = `proof/${opId}.${ext}`;
          const buf = Buffer.from(item.photoBase64, "base64");
          const ct = item.photoContentType || (ext === "webp" ? "image/webp" : "image/jpeg");
          await query(
            "INSERT INTO upload_objects(object_key,kind,content_type,size_bytes,file_data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(object_key) DO UPDATE SET file_data=EXCLUDED.file_data, size_bytes=EXCLUDED.size_bytes",
            [item.photoKey, "proof", ct, buf.byteLength, buf],
          );
          try {
            const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
            await mkdir(uploadDir, { recursive: true });
            await writeFile(resolve(uploadDir, encodeURIComponent(item.photoKey)), buf);
          } catch {}
        }
        if (item.photoKey && item.photoBase64) {
          try {
            const buf = Buffer.from(item.photoBase64, "base64");
            await query(
              "UPDATE upload_objects SET file_data=COALESCE(file_data, $1), size_bytes=COALESCE(size_bytes, $2) WHERE object_key=$3",
              [buf, buf.byteLength, item.photoKey],
            );
          } catch {}
        }
      }

      const validPhotos = rawPhotos.filter((p) => Boolean(p.photoKey));
      if (
        validPhotos.length === 0 ||
        !Number.isFinite(Number(data.lat)) ||
        !Number.isFinite(Number(data.lng))
      )
        return json({ error: "Foto e localização são obrigatórias" }, 400);

      const client = await db.connect();
      try {
        await client.query("BEGIN");

        const route = await client.query(
          `SELECT r.company_id,r.name AS route_name,d.name AS driver_name,s.name AS stop_name
           FROM routes r
           LEFT JOIN drivers d ON d.id=r.driver_id
           JOIN route_stops s ON s.id=$3 AND s.route_id=r.id
           WHERE r.id=$1 AND r.driver_id=$2 AND r.status IN ('active', 'completed')`,
          [p[1], session.driverId, p[3]],
        );
        if (!route.rows[0]) throw new Error("Rota não está ativa");
        const outcome = ["entregue", "cliente_ausente", "endereco_incorreto", "recusado"].includes(data.occurrence) ? data.occurrence : "entregue";

        const processedPhotos: Array<{ operationId: string; photoKey: string }> = [];

        for (const item of validPhotos) {
          const itemOpId = item.operationId || data.operationId || randomUUID();
          // Idempotency check: strictly by operation_id to allow multiple deliveries/photos for the same stop
          const existingEvent = await client.query(
            "SELECT operation_id, photo_key FROM delivery_events WHERE operation_id=$1",
            [itemOpId],
          );
          if (existingEvent.rows[0]) {
            processedPhotos.push({
              operationId: existingEvent.rows[0].operation_id || itemOpId,
              photoKey: existingEvent.rows[0].photo_key || item.photoKey!,
            });
            continue;
          }

          const photoNote = item.note || data.note || null;
          await client.query(
            "INSERT INTO delivery_events(operation_id,route_id,stop_id,photo_key,note,lat,lng,occurrence) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(operation_id) DO NOTHING",
            [
              itemOpId,
              p[1],
              p[3],
              item.photoKey,
              photoNote,
              data.lat,
              data.lng,
              outcome,
            ],
          );
          processedPhotos.push({ operationId: itemOpId, photoKey: item.photoKey! });
        }

        await client.query(
          "UPDATE route_stops SET status='delivered', delivery_outcome=$3, delivered_at=COALESCE(delivered_at,now()) WHERE id=$1 AND route_id=$2 AND NOT is_origin",
          [p[3], p[1], outcome],
        );
        await client.query("COMMIT");
        if (outcome === "entregue") {
          const routeData = route.rows[0];
          void notifyOperationOfDeliveredStop({
            companyId: routeData.company_id,
            routeId: p[1],
            routeName: routeData.route_name || "Rota em andamento",
            stopName: routeData.stop_name || "destino",
            driverName: routeData.driver_name || "Motorista",
          }).catch((error) => console.error("[delivery] Erro no push da entrega", error));
        }
        return json({
          ok: true,
          operationId: processedPhotos[0]?.operationId || data.operationId,
          photoKey: processedPhotos[0]?.photoKey || validPhotos[0]?.photoKey,
          photos: processedPhotos,
          count: processedPhotos.length,
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    if (
      p[0] === "routes" &&
      p[2] === "location" &&
      session &&
      session.role === "driver"
    ) {
      const points = Array.isArray(data.points) ? data.points : [data];
      for (const pt of points) {
        if (!pt.operationId || !Number.isFinite(Number(pt.lat)) || !Number.isFinite(Number(pt.lng)))
          continue;
        await query(
          "INSERT INTO location_points(operation_id,route_id,driver_id,lat,lng,accuracy,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) DO NOTHING",
          [
            pt.operationId,
            p[1],
            session.driverId,
            pt.lat,
            pt.lng,
            pt.accuracy || null,
            pt.recordedAt || new Date().toISOString(),
          ],
        );
      }
      return json({ ok: true, count: points.length });
    }
    if (p[0] === "routes" && p[2] === "finish" && session && session.role === "driver") {
      let photoKey = data.photoKey;
      if (!photoKey && data.photoBase64) {
        const ext = String(data.photoContentType || "").includes("webp") ? "webp" : "jpg";
        const opId = data.operationId || randomUUID();
        photoKey = `finish/${opId}.${ext}`;
        const buf = Buffer.from(data.photoBase64, "base64");
        const ct = data.photoContentType || (ext === "webp" ? "image/webp" : "image/jpeg");
        await query(
          "INSERT INTO upload_objects(object_key,kind,content_type,size_bytes,file_data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(object_key) DO UPDATE SET file_data=EXCLUDED.file_data, size_bytes=EXCLUDED.size_bytes",
          [photoKey, "finish", ct, buf.byteLength, buf],
        );
        try {
          const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
          await mkdir(uploadDir, { recursive: true });
          await writeFile(resolve(uploadDir, encodeURIComponent(photoKey)), buf);
        } catch {}
      }
      if (photoKey && data.photoBase64) {
        try {
          const buf = Buffer.from(data.photoBase64, "base64");
          await query(
            "UPDATE upload_objects SET file_data=COALESCE(file_data, $1), size_bytes=COALESCE(size_bytes, $2) WHERE object_key=$3",
            [buf, buf.byteLength, photoKey],
          );
        } catch {}
      }
      if (!photoKey || !Number.isFinite(Number(data.kilometers)))
        return json({ error: "Quilometragem e foto são obrigatórias" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query(
          "SELECT r.vehicle_id,o.kilometers start_km,(SELECT count(*) FROM route_stops s WHERE s.route_id=r.id AND NOT s.is_origin AND s.status='pending') pending FROM routes r JOIN odometer_readings o ON o.route_id=r.id AND o.phase='start' WHERE r.id=$1 AND r.driver_id=$2 AND r.status='active' FOR UPDATE",
          [p[1], session.driverId],
        );
        if (!r.rows[0]) {
          const completed = await client.query(
            "SELECT 1 FROM routes WHERE id=$1 AND driver_id=$2 AND status='completed'",
            [p[1], session.driverId],
          );
          if (completed.rows[0]) {
            await client.query("COMMIT");
            return json({ ok: true, message: "Rota já finalizada", photoKey });
          }
          throw new Error("Rota não está ativa");
        }
        const startKm = Number(r.rows[0]?.start_km || 0);
        if (Number(data.kilometers) < startKm)
          throw new Error(`Quilometragem final (${data.kilometers} km) não pode ser menor que a inicial registrada (${startKm} km).`);
        if (Number(r.rows[0].pending) > 0 && !data.confirmIncomplete)
          throw new Error("Confirme o encerramento com entregas pendentes");
        await client.query(
          "INSERT INTO odometer_readings(route_id,phase,kilometers,photo_key,lat,lng) VALUES($1,'finish',$2,$3,$4,$5) ON CONFLICT (route_id, phase) DO UPDATE SET kilometers=EXCLUDED.kilometers, photo_key=EXCLUDED.photo_key, lat=EXCLUDED.lat, lng=EXCLUDED.lng",
          [p[1], data.kilometers, photoKey, data.lat, data.lng],
        );
        const actualKm = Number((Number(data.kilometers) - Number(r.rows[0].start_km)).toFixed(1));
        await client.query(
          "UPDATE routes SET status='completed',finished_at=now(),actual_km=$2 WHERE id=$1",
          [p[1], actualKm],
        );
        await client.query(
          "UPDATE vehicles SET current_odometer=$2 WHERE id=$1",
          [r.rows[0].vehicle_id, data.kilometers],
        );
        await client.query("COMMIT");
        await audit(
          "driver",
          session.driverId || null,
          "finish",
          "route",
          p[1],
        );
        return json({
          ok: true,
          actualKm: Number(data.kilometers) - Number(r.rows[0].start_km),
        });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    if (p[0] === "admin" && p[1] === "reset-data")
      return json({ error: "Operação de reset desativada" }, 403);

    return json({ error: "Não encontrado" }, 404);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "Erro interno" },
      500,
    );
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const p = routeParts((await ctx.params).path);
  try {
    if (p[0] === "uploads" && p[1] === "local") {
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > 25 * 1024 * 1024)
        return json({ error: "Foto maior que 25 MB" }, 413);
      const rawKey = p.slice(2).join("/");
      const key = decodeURIComponent(rawKey);
      const buf = Buffer.from(bytes);

      // 1. Save directly to PostgreSQL upload_objects bytea (never fails due to Linux permissions or container redeploys)
      try {
        await query(
          "UPDATE upload_objects SET file_data=$1, size_bytes=$2 WHERE object_key=$3",
          [buf, buf.length, key],
        );
      } catch (dbErr) {
        console.warn("DB upload PUT notice:", dbErr);
      }

      // 2. Best-effort local file write (wrapped in try/catch so EACCES never fails the response)
      try {
        const safeName = encodeURIComponent(key);
        const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
        await mkdir(uploadDir, { recursive: true });
        await writeFile(resolve(uploadDir, safeName), buf);
      } catch {
        try {
          const safeName = encodeURIComponent(key);
          const tmpDir = resolve("/tmp", "uploads");
          await mkdir(tmpDir, { recursive: true });
          await writeFile(resolve(tmpDir, safeName), buf);
        } catch {}
      }

      return new NextResponse(null, { status: 204 });
    }

    const session = await getSession(requestedRole(req));
    if (!session || session.role !== "dispatcher")
      return json({ error: "Acesso restrito" }, 403);

    if (p[0] === "routes" && p[1] && p.length === 2) {
      const data = await body(req);
      if (!Array.isArray(data.stops) || data.stops.length < 2)
        return json({ error: "Adicione uma origem e ao menos uma entrega" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const current = await client.query(
          "SELECT id,status FROM routes WHERE id=$1 AND company_id=$2 FOR UPDATE",
          [p[1], session.companyId],
        );
        if (!current.rows[0]) {
          await client.query("ROLLBACK");
          return json({ error: "Rota não encontrada" }, 404);
        }
        if (await hasRouteMinimumException(client, p[1], session.companyId!)) {
          await client.query("ROLLBACK");
          return json({ error: "Rota com exceção auditada: volte ao roteirizador para nova autorização antes de alterar." }, 409);
        }
        if (!["draft", "assigned"].includes(String(current.rows[0].status))) {
          await client.query("ROLLBACK");
          return json({ error: "Uma rota já iniciada não pode ser alterada. Cancele e duplique a rota." }, 409);
        }
        const updated = await client.query(
          "UPDATE routes SET name=$1,route_date=$2,optimize_by=$3,circular=$4,estimated_km=$5 WHERE id=$6 AND company_id=$7 RETURNING *",
          [String(data.name || "").trim(), data.routeDate, data.optimizeBy || "distance", !!data.circular, data.estimatedKm || null, p[1], session.companyId],
        );
        await client.query("DELETE FROM route_stops WHERE route_id=$1", [p[1]]);
        for (let i = 0; i < data.stops.length; i++) {
          const s = data.stops[i];
          await client.query(
            "INSERT INTO route_stops(route_id,position,name,address,lat,lng,is_origin,boxes,volume_m3) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [p[1], i, s.name, s.address, Number(s.lat), Number(s.lng), i === 0, s.boxes ? Number(s.boxes) : null, s.volume_m3 ? Number(s.volume_m3) : null],
          );
        }
        await client.query("COMMIT");
        await audit("dispatcher", session.dispatcherId || null, "update", "route", p[1], { stops: data.stops.length });
        return json(updated.rows[0]);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }

    if (p[0] === "drivers" && p[1]) {
      const data = await body(req);
      let photo;
      try { photo = await normalizeDriverPhoto(data.photo); }
      catch (e) { return json({ error: (e as Error).message }, 400); }
      const name = String(data.name || "").trim();
      if (!name) return json({ error: "Nome é obrigatório" }, 400);
      const phone = data.phone ? String(data.phone).trim() : null;
      const active = data.active !== false;

      if (data.password) {
        if (!/^\d{4,8}$/.test(String(data.password)))
          return json({ error: "Defina uma senha numérica de 4 a 8 dígitos" }, 400);
        const pinHash = await hash(String(data.password), 10);
        const { rows } = await query(
          "UPDATE drivers SET name=$1, phone=$2, pin_hash=$3, active=$4, photo=CASE WHEN $7 THEN $8 ELSE photo END WHERE id=$5 AND company_id=$6 RETURNING id,public_id,name,phone,photo,active",
          [name, phone, pinHash, active, p[1], session.companyId, data.photo !== undefined, photo],
        );
        if (!rows[0]) return json({ error: "Motorista não encontrado" }, 404);
        await audit("dispatcher", null, "update", "driver", p[1], { name, phone, active });
        return json(rows[0]);
      } else {
        const { rows } = await query(
          "UPDATE drivers SET name=$1, phone=$2, active=$3, photo=CASE WHEN $6 THEN $7 ELSE photo END WHERE id=$4 AND company_id=$5 RETURNING id,public_id,name,phone,photo,active",
          [name, phone, active, p[1], session.companyId, data.photo !== undefined, photo],
        );
        if (!rows[0]) return json({ error: "Motorista não encontrado" }, 404);
        await audit("dispatcher", null, "update", "driver", p[1], { name, phone, active });
        return json(rows[0]);
      }
    }

    if (p[0] === "vehicles" && p[1]) {
      const data = await body(req);
      const name = String(data.name || "").trim();
      const plate = String(data.plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const odometer = Number(data.current_odometer ?? data.odometer);
      const ratePerKm = data.rate_per_km !== undefined && data.rate_per_km !== null && data.rate_per_km !== "" ? Number(data.rate_per_km) : null;
      const active = data.active !== false;
      if (!name || !plate) return json({ error: "Nome e placa são obrigatórios" }, 400);

      const { rows } = await query(
        "UPDATE vehicles SET name=$1, plate=$2, current_odometer=$3, rate_per_km=$4, active=$5 WHERE id=$6 AND company_id=$7 RETURNING *",
        [name, plate, isNaN(odometer) ? 0 : odometer, ratePerKm, active, p[1], session.companyId],
      );
      if (!rows[0]) return json({ error: "Veículo não encontrado" }, 404);
      await audit("dispatcher", null, "update", "vehicle", p[1], { name, plate, odometer, ratePerKm, active });
      return json(rows[0]);
    }

    if (p[0] === "dispatchers" && p[1]) {
      const data = await body(req);
      const name = String(data.name || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const active = data.active !== false;
      if (!name || !email.includes("@"))
        return json({ error: "Nome e e-mail válidos são obrigatórios" }, 400);

      if (session.dispatcherId === p[1] && !active) {
        return json({ error: "Você não pode desativar o seu próprio usuário gestor conectado." }, 400);
      }

      const checkEmail = await query(
        "SELECT id FROM dispatchers WHERE company_id=$1 AND lower(email)=$2 AND id<>$3",
        [session.companyId, email, p[1]],
      );
      if (checkEmail.rows[0]) {
        return json({ error: "Já existe outro gestor com este e-mail nesta empresa" }, 409);
      }

      const role = data.role && ["admin", "route_creator", "office"].includes(data.role) ? data.role : undefined;

      if (data.password && String(data.password).length >= 6) {
        const passHash = await hash(String(data.password), 10);
        const { rows } = await query(
          "UPDATE dispatchers SET name=$1, email=$2, active=$3, password_hash=$4, role=COALESCE($7, role) WHERE id=$5 AND company_id=$6 RETURNING id,name,email,role,active,created_at",
          [name, email, active, passHash, p[1], session.companyId, role],
        );
        if (!rows[0]) return json({ error: "Usuário não encontrado" }, 404);
        await audit("dispatcher", session.dispatcherId || null, "update", "dispatcher", p[1], { name, email, active, role, password_changed: true });
        return json(rows[0]);
      } else {
        const { rows } = await query(
          "UPDATE dispatchers SET name=$1, email=$2, active=$3, role=COALESCE($6, role) WHERE id=$4 AND company_id=$5 RETURNING id,name,email,role,active,created_at",
          [name, email, active, p[1], session.companyId, role],
        );
        if (!rows[0]) return json({ error: "Usuário não encontrado" }, 404);
        await audit("dispatcher", session.dispatcherId || null, "update", "dispatcher", p[1], { name, email, active, role, password_changed: false });
        return json(rows[0]);
      }
    }

    if (p[0] === "companies" && p[1]) {
      if (session.userRole !== "superadmin") {
        return json({ error: "Apenas o Administrador Supremo pode gerenciar empresas" }, 403);
      }
      const data = await body(req);
      const name = String(data.name || "").trim();
      const active = Boolean(data.active !== false);
      if (!name) return json({ error: "Nome da empresa é obrigatório" }, 400);

      const { rows } = await query(
        "UPDATE companies SET name=$1, active=$2 WHERE id=$3 RETURNING id, code, name, active, created_at",
        [name, active, p[1]],
      );
      if (!rows[0]) return json({ error: "Empresa não encontrada" }, 404);
      await audit("dispatcher", session.dispatcherId || null, "update", "company", p[1], { name, active });
      return json(rows[0]);
    }

    return json({ error: "Não encontrado" }, 404);
  } catch (e: any) {
    if (e?.code === "23505" || String(e?.message).includes("vehicles_plate_key")) {
      return json({ error: "Já existe um veículo cadastrado com esta placa." }, 409);
    }
    return json({ error: e instanceof Error ? e.message : "Erro interno" }, 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const p = routeParts((await ctx.params).path);
  const session = await getSession(requestedRole(req));
  if (!session || session.role !== "dispatcher")
    return json({ error: "Acesso restrito" }, 403);
  try {
    if (p[0] === "companies" && p[1]) {
      if (session.userRole !== "superadmin") {
        return json({ error: "Apenas o Administrador Supremo pode excluir empresas" }, 403);
      }
      const compCheck = await query("SELECT id, code, name FROM companies WHERE id=$1", [p[1]]);
      if (!compCheck.rows[0]) return json({ error: "Empresa não encontrada" }, 404);
      if (compCheck.rows[0].code === "EU") {
        return json({ error: "A empresa principal (EU) do Administrador Supremo não pode ser excluída." }, 400);
      }

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        // Deletar dependências da empresa
        await client.query("DELETE FROM audit_log WHERE company_id=$1", [p[1]]).catch(() => {});
        // Apaga eventos e registros das rotas da empresa
        await client.query("DELETE FROM delivery_events WHERE route_id IN (SELECT id FROM routes WHERE company_id=$1)", [p[1]]).catch(() => {});
        await client.query("DELETE FROM odometer_readings WHERE route_id IN (SELECT id FROM routes WHERE company_id=$1)", [p[1]]).catch(() => {});
        await client.query("DELETE FROM location_points WHERE route_id IN (SELECT id FROM routes WHERE company_id=$1)", [p[1]]).catch(() => {});
        await client.query("DELETE FROM sync_operations WHERE route_id IN (SELECT id FROM routes WHERE company_id=$1)", [p[1]]).catch(() => {});
        await client.query("DELETE FROM route_stops WHERE route_id IN (SELECT id FROM routes WHERE company_id=$1)", [p[1]]).catch(() => {});
        await client.query("DELETE FROM routes WHERE company_id=$1", [p[1]]);
        await client.query("DELETE FROM vehicles WHERE company_id=$1", [p[1]]);
        await client.query("DELETE FROM drivers WHERE company_id=$1", [p[1]]);
        await client.query("DELETE FROM dispatchers WHERE company_id=$1", [p[1]]);
        await client.query("DELETE FROM companies WHERE id=$1", [p[1]]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }

      await audit("dispatcher", session.dispatcherId || null, "delete", "company", p[1], { code: compCheck.rows[0].code, name: compCheck.rows[0].name });
      return json({ ok: true, deleted: compCheck.rows[0] });
    }
    if (p[0] === "drivers" && p[1]) {
      const { rows } = await query(
        "UPDATE drivers SET active=false WHERE id=$1 AND company_id=$2 RETURNING id",
        [p[1], session.companyId],
      );
      if (!rows[0]) return json({ error: "Motorista não encontrado" }, 404);
      await audit("dispatcher", null, "inactivate", "driver", p[1]);
      return json({ ok: true });
    }
    if (p[0] === "vehicles" && p[1]) {
      const { rows } = await query(
        "UPDATE vehicles SET active=false WHERE id=$1 AND company_id=$2 RETURNING id",
        [p[1], session.companyId],
      );
      if (!rows[0]) return json({ error: "Veículo não encontrado" }, 404);
      await audit("dispatcher", null, "inactivate", "vehicle", p[1]);
      return json({ ok: true });
    }
    if (p[0] === "dispatchers" && p[1]) {
      if (session.dispatcherId === p[1]) {
        return json({ error: "Você não pode desativar o seu próprio usuário gestor conectado." }, 400);
      }
      const { rows } = await query(
        "UPDATE dispatchers SET active=false WHERE id=$1 AND company_id=$2 RETURNING id",
        [p[1], session.companyId],
      );
      if (!rows[0]) return json({ error: "Gestor não encontrado" }, 404);
      await audit("dispatcher", session.dispatcherId || null, "inactivate", "dispatcher", p[1]);
      return json({ ok: true });
    }
    return json({ error: "Não encontrado" }, 404);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erro interno" }, 500);
  }
}
