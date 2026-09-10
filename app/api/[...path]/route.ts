import { NextRequest, NextResponse } from "next/server";
import { compare, hash } from "bcryptjs";
import { randomUUID } from "crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { audit, db, query } from "@/lib/db";
import { getSession, makeSession, sessionCookie } from "@/lib/auth";
import { uploadUrl, viewUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });
async function body(req: NextRequest) {
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
          headers: { "User-Agent": "RouteWise-Proxy/1.0", Accept: "application/json" },
          signal: AbortSignal.timeout(12000),
        });
        const data = await response.json();
        return json(data, response.ok ? 200 : response.status);
      } catch (err) {
        return json({ error: `OSRM fetch failed: ${(err as Error).message}` }, 502);
      }
    }
    if (p[0] === "stations") {
      try {
        const response = await fetch(
          "https://sistema.efleet.digital:8443/fleet/ws/api.php",
          {
            headers: { Operacao: "ViewStations", Accept: "application/json" },
            signal: AbortSignal.timeout(8000),
            next: { revalidate: 600 },
          },
        );
        if (!response.ok) throw new Error("Rede de postos indisponível");
        return json(await response.json());
      } catch (err) {
        console.warn("Stations fetch failed, returning empty list fallback:", err);
        return json([]);
      }
    }
    if (p[0] === "uploads" && p[1] === "local") {
      const rawKey = p.slice(2).join("/");
      const key = decodeURIComponent(rawKey);
      const safeName = encodeURIComponent(key);
      const filePath = resolve(process.cwd(), ".local-db", "uploads", safeName);
      if (!existsSync(filePath)) {
        return json({ error: "Arquivo não encontrado" }, 404);
      }
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
    if (p[0] === "session" && p[1] === "me") {
      const session = await getSession(requestedRole(req));
      if (!session) return json({ authenticated: false }, 200);
      let companyCode = "";
      let companyName = "";
      if (session.companyId) {
        const comp = await query("SELECT code, name FROM companies WHERE id=$1", [session.companyId]);
        if (comp.rows[0]) {
          companyCode = comp.rows[0].code;
          companyName = comp.rows[0].name;
        }
      }
      return json({
        authenticated: true,
        role: session.role,
        companyId: session.companyId,
        companyCode,
        companyName,
        dispatcherId: session.dispatcherId,
        driverId: session.driverId,
      });
    }
    if (p[0] === "dispatchers" && p.length === 1) {
      const session = await getSession(requestedRole(req));
      if (!session || session.role !== "dispatcher") return json({ error: "Acesso restrito" }, 403);
      const { rows } = await query(
        "SELECT id, name, email, active, created_at FROM dispatchers WHERE company_id=$1 ORDER BY active DESC, created_at ASC",
        [session.companyId],
      );
      return json(rows);
    }
    if (p[0] === "drivers" && p.length === 1) {
      const sp = req.nextUrl.searchParams;
      const all = sp.get("all") === "true";
      const session = await getSession(requestedRole(req));
      let companyId = session?.companyId;
      if (!companyId && sp.get("company")) {
        const company = await query("SELECT id FROM companies WHERE code=upper($1) AND active=true", [sp.get("company")]);
        companyId = company.rows[0]?.id;
      }
      if (!companyId) return json({ error: "Informe o código da empresa" }, 400);
      const showAll = all && session?.role === "dispatcher";
      const { rows } = await query(
        `SELECT id,public_id,name,phone,active,created_at FROM drivers WHERE company_id=$1 ${showAll ? "" : "AND active=true"} ORDER BY active DESC, name ASC`,
        [companyId],
      );
      return json(rows);
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
        `SELECT r.*, to_char(r.route_date, 'YYYY-MM-DD') route_date, d.name driver_name,v.name vehicle_name,v.plate,
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
        `SELECT r.*, to_char(r.route_date, 'YYYY-MM-DD') route_date, d.name driver_name,v.name vehicle_name,v.plate,
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
      const code = String(data.companyCode || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      if (code.length < 3 || !email.includes("@") || password.length < 6 || !String(data.companyName || "").trim())
        return json({ error: "Preencha empresa, código, e-mail e senha de ao menos 6 caracteres" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const company = await client.query("INSERT INTO companies(code,name) VALUES($1,$2) RETURNING id,code,name", [code, String(data.companyName).trim()]);
        const dispatcher = await client.query("INSERT INTO dispatchers(company_id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id", [company.rows[0].id, String(data.name || "Gestor").trim(), email, await hash(password, 10)]);
        await client.query("COMMIT");
        const res = json({ ok: true, company: company.rows[0] }, 201);
        res.cookies.set(sessionCookie(await makeSession({ role: "dispatcher", companyId: company.rows[0].id, dispatcherId: dispatcher.rows[0].id }), "dispatcher"));
        return res;
      } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    }
    if (p.join("/") === "session/dispatcher") {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
      const key = `pin:${ip}`;
      const now = Date.now();
      const limiter = ((
        globalThis as typeof globalThis & {
          rwPin?: Map<string, { n: number; until: number }>;
        }
      ).rwPin ??= new Map());
      const hit = limiter.get(key);
      if (hit && hit.n >= 5 && hit.until > now)
        return json({ error: "Muitas tentativas. Aguarde 15 minutos." }, 429);
      if (data.pin) {
        const configured = process.env.DISPATCHER_PIN_HASH;
        const valid = configured
          ? await compare(String(data.pin || ""), configured)
          : String(data.pin) === (process.env.DISPATCHER_PIN || "2468");
        if (!valid) {
          limiter.set(key, { n: (hit?.n || 0) + 1, until: now + 900000 });
          return json({ error: "PIN incorreto" }, 401);
        }
        limiter.delete(key);
        const comp = await query("SELECT id FROM companies LIMIT 1");
        const companyId = comp.rows[0]?.id || "00000000-0000-0000-0000-000000000000";
        const res = json({ ok: true });
        res.cookies.set(sessionCookie(await makeSession({ role: "dispatcher", companyId }), "dispatcher"));
        return res;
      }

      const companyCode = String(data.companyCode || "").trim().toUpperCase();
      const email = String(data.email || "").trim().toLowerCase();
      const { rows } = await query("SELECT u.id,u.company_id,u.password_hash,c.name company_name FROM dispatchers u JOIN companies c ON c.id=u.company_id WHERE c.code=$1 AND lower(u.email)=$2 AND u.active=true AND c.active=true", [companyCode, email]);
      if (!rows[0] || !(await compare(String(data.password || ""), rows[0].password_hash))) {
        limiter.set(key, { n: (hit?.n || 0) + 1, until: now + 900000 });
        return json({ error: "Empresa, e-mail ou senha inválidos" }, 401);
      }
      limiter.delete(key);
      const res = json({ ok: true, companyName: rows[0].company_name });
      res.cookies.set(sessionCookie(await makeSession({ role: "dispatcher", companyId: rows[0].company_id, dispatcherId: rows[0].id }), "dispatcher"));
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
      const res = json({ ok: true });
      res.cookies.set(
        sessionCookie(
          await makeSession({ role: "driver", driverId: rows[0].id, companyId: rows[0].company_id }),
          "driver",
        ),
      );
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
    const session = await getSession(requestedRole(req));
    const isDispatcher = session?.role === "dispatcher";

    if (!session && !isDispatcher) return json({ error: "Sessão necessária" }, 401);
    if (p[0] === "dispatchers" && isDispatcher) {
      const name = String(data.name || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const password = String(data.password || "");
      if (!name || !email.includes("@") || password.length < 6)
        return json({ error: "Preencha nome, e-mail válido e senha com no mínimo 6 caracteres" }, 400);

      const existing = await query(
        "SELECT 1 FROM dispatchers WHERE company_id=$1 AND lower(email)=$2",
        [session!.companyId, email],
      );
      if (existing.rows[0])
        return json({ error: "Já existe um gestor com este e-mail nesta empresa" }, 409);

      const { rows } = await query(
        "INSERT INTO dispatchers(company_id,name,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email,active,created_at",
        [session!.companyId, name, email, await hash(password, 10)],
      );
      await audit("dispatcher", session!.dispatcherId || null, "create", "dispatcher", rows[0].id);
      return json(rows[0], 201);
    }
    if (p[0] === "drivers" && isDispatcher) {
      if (!/^\d{4,8}$/.test(String(data.password || "")))
        return json({ error: "Defina uma senha numérica de 4 a 8 dígitos" }, 400);
      const { rows } = await query(
        "INSERT INTO drivers(company_id,name,phone,pin_hash) VALUES($1,$2,$3,$4) RETURNING id,public_id,name,phone,active",
        [session!.companyId, data.name, data.phone || null, await hash(String(data.password), 10)],
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
        [session!.companyId, data.name, plate, Number(data.odometer || 0), ratePerKm],
      );
      await audit("dispatcher", null, "create", "vehicle", rows[0].id);
      return json(rows[0], 201);
    }
    if (p[0] === "routes" && p.length === 1 && isDispatcher) {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const isAssigned = !!(data.driverId && data.vehicleId);
        const rr = await client.query(
          "INSERT INTO routes(company_id,name,route_date,optimize_by,circular,estimated_km,driver_id,vehicle_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            session!.companyId,
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
          await client.query(
            "INSERT INTO route_stops(route_id,position,name,address,lat,lng,is_origin) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [rr.rows[0].id, i, s.name, s.address, s.lat, s.lng, i === 0],
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
      if (!data.photoKey || !Number.isFinite(Number(data.kilometers)))
        return json({ error: "Quilometragem e foto são obrigatórias" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query(
          "UPDATE routes SET status='active',started_at=now() WHERE id=$1 AND driver_id=$2 AND status='assigned' RETURNING vehicle_id",
          [p[1], session.driverId],
        );
        if (!r.rows[0]) throw new Error("Rota não pode ser iniciada");
        const v = await client.query(
          "SELECT current_odometer FROM vehicles WHERE id=$1 FOR UPDATE",
          [r.rows[0].vehicle_id],
        );
        if (Number(data.kilometers) < Number(v.rows[0].current_odometer))
          throw new Error("Quilometragem inferior ao último registro");
        await client.query(
          "INSERT INTO odometer_readings(route_id,phase,kilometers,photo_key,lat,lng) VALUES($1,'start',$2,$3,$4,$5)",
          [p[1], data.kilometers, data.photoKey, data.lat, data.lng],
        );
        await client.query("COMMIT");
        await audit("driver", session.driverId || null, "start", "route", p[1]);
        return json({ ok: true });
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
      if (
        !data.operationId ||
        !data.photoKey ||
        !Number.isFinite(Number(data.lat)) ||
        !Number.isFinite(Number(data.lng))
      )
        return json({ error: "Foto e localização são obrigatórias" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const route = await client.query(
          "SELECT 1 FROM routes WHERE id=$1 AND driver_id=$2 AND status='active'",
          [p[1], session.driverId],
        );
        if (!route.rows[0]) throw new Error("Rota não está ativa");
        await client.query(
          "INSERT INTO delivery_events(operation_id,route_id,stop_id,photo_key,note,lat,lng) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(operation_id) DO NOTHING",
          [
            data.operationId,
            p[1],
            p[3],
            data.photoKey,
            data.note || null,
            data.lat,
            data.lng,
          ],
        );
        await client.query(
          "UPDATE route_stops SET status='delivered',delivered_at=COALESCE(delivered_at,now()) WHERE id=$1 AND route_id=$2 AND NOT is_origin",
          [p[3], p[1]],
        );
        await client.query("COMMIT");
        return json({ ok: true });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
    if (p[0] === "routes" && p[2] === "location" && session && session.role === "driver") {
      const points = Array.isArray(data.points) ? data.points : [];
      for (const point of points.slice(0, 100))
        await query(
          "INSERT INTO location_points(operation_id,route_id,driver_id,lat,lng,accuracy,recorded_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM routes WHERE id=$2 AND driver_id=$3 AND status='active') ON CONFLICT(operation_id) DO NOTHING",
          [
            point.operationId,
            p[1],
            session.driverId,
            point.lat,
            point.lng,
            point.accuracy || null,
            point.recordedAt,
          ],
        );
      return json({ ok: true, count: points.length });
    }
    if (p[0] === "routes" && p[2] === "finish" && session && session.role === "driver") {
      if (!data.photoKey || !Number.isFinite(Number(data.kilometers)))
        return json({ error: "Quilometragem e foto são obrigatórias" }, 400);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const r = await client.query(
          "SELECT r.vehicle_id,o.kilometers start_km,(SELECT count(*) FROM route_stops s WHERE s.route_id=r.id AND NOT s.is_origin AND s.status='pending') pending FROM routes r JOIN odometer_readings o ON o.route_id=r.id AND o.phase='start' WHERE r.id=$1 AND r.driver_id=$2 AND r.status='active' FOR UPDATE",
          [p[1], session.driverId],
        );
        if (!r.rows[0]) throw new Error("Rota não está ativa");
        if (Number(data.kilometers) < Number(r.rows[0].start_km))
          throw new Error("Quilometragem final menor que a inicial");
        if (Number(r.rows[0].pending) > 0 && !data.confirmIncomplete)
          throw new Error("Confirme o encerramento com entregas pendentes");
        await client.query(
          "INSERT INTO odometer_readings(route_id,phase,kilometers,photo_key,lat,lng) VALUES($1,'finish',$2,$3,$4,$5)",
          [p[1], data.kilometers, data.photoKey, data.lat, data.lng],
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
      if (process.env.AWS_S3_BUCKET_NAME) return json({ error: "Não encontrado" }, 404);
      const bytes = await req.arrayBuffer();
      if (bytes.byteLength > 25 * 1024 * 1024)
        return json({ error: "Foto maior que 25 MB" }, 413);
      const rawKey = p.slice(2).join("/");
      const key = decodeURIComponent(rawKey);
      const safeName = encodeURIComponent(key);
      const uploadDir = resolve(process.cwd(), ".local-db", "uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(resolve(uploadDir, safeName), Buffer.from(bytes));
      return new NextResponse(null, { status: 204 });
    }

    const session = await getSession(requestedRole(req));
    if (!session || session.role !== "dispatcher")
      return json({ error: "Acesso restrito" }, 403);

    if (p[0] === "drivers" && p[1]) {
      const data = await body(req);
      const name = String(data.name || "").trim();
      if (!name) return json({ error: "Nome é obrigatório" }, 400);
      const phone = data.phone ? String(data.phone).trim() : null;
      const active = data.active !== false;

      if (data.password) {
        if (!/^\d{4,8}$/.test(String(data.password)))
          return json({ error: "Defina uma senha numérica de 4 a 8 dígitos" }, 400);
        const pinHash = await hash(String(data.password), 10);
        const { rows } = await query(
          "UPDATE drivers SET name=$1, phone=$2, pin_hash=$3, active=$4 WHERE id=$5 AND company_id=$6 RETURNING id,public_id,name,phone,active",
          [name, phone, pinHash, active, p[1], session.companyId],
        );
        if (!rows[0]) return json({ error: "Motorista não encontrado" }, 404);
        await audit("dispatcher", null, "update", "driver", p[1], { name, phone, active });
        return json(rows[0]);
      } else {
        const { rows } = await query(
          "UPDATE drivers SET name=$1, phone=$2, active=$3 WHERE id=$4 AND company_id=$5 RETURNING id,public_id,name,phone,active",
          [name, phone, active, p[1], session.companyId],
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

      if (data.password && String(data.password).length >= 6) {
        const passHash = await hash(String(data.password), 10);
        const { rows } = await query(
          "UPDATE dispatchers SET name=$1, email=$2, active=$3, password_hash=$4 WHERE id=$5 AND company_id=$6 RETURNING id,name,email,active,created_at",
          [name, email, active, passHash, p[1], session.companyId],
        );
        if (!rows[0]) return json({ error: "Gestor não encontrado" }, 404);
        await audit("dispatcher", session.dispatcherId || null, "update", "dispatcher", p[1], { name, email, active, password_changed: true });
        return json(rows[0]);
      } else {
        const { rows } = await query(
          "UPDATE dispatchers SET name=$1, email=$2, active=$3 WHERE id=$4 AND company_id=$5 RETURNING id,name,email,active,created_at",
          [name, email, active, p[1], session.companyId],
        );
        if (!rows[0]) return json({ error: "Gestor não encontrado" }, 404);
        await audit("dispatcher", session.dispatcherId || null, "update", "dispatcher", p[1], { name, email, active, password_changed: false });
        return json(rows[0]);
      }
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
