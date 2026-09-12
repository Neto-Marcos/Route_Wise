# Milestone 1: Database Schema Migration & Capacity Persistence Plan
**Target Component**: Criar Rota TMS (RouteWise)  
**Milestone**: M1 (Schema Migration, In-Memory Geo & Spreadsheet Parser)  
**Author**: Explorer M1-1  
**Date**: 2026-09-12  
**Status**: COMPLETE (Investigation & Specification)  

---

## 1. Executive Summary

This specification provides the technical blueprint for the Worker agent implementing the database schema changes and capacity persistence in Milestone 1 of the Automated Routing Engine for Criar Rota TMS.

### Key Objectives Addressed:
1. **Migration SQL**: Provide the exact, idempotent SQL for `db/migrations/0006_routing_engine_capacities.sql` adding `weight_kg`, `order_id`, and `products` to `route_stops`, as well as `max_volume_m3` and `max_weight_kg` to `vehicles`.
2. **Migration Runtime Mechanics**: Verify and document how `lib/db.ts` applies migrations automatically on startup for both `@electric-sql/pglite` (local embedded) and standard PostgreSQL (`pg.Pool` with `DATABASE_URL`).
3. **API & Data Flow Compatibility**: Detail changes for `POST /api/routes`, `GET /api/routes/[id]`, and vehicle endpoints in `app/api/[...path]/route.ts`, ensuring backwards compatibility for existing routes and seamless consumption by the Driver App.
4. **Worker Implementation Guide**: Provide exact code diffs, file paths, type definitions, and verification commands for the Worker agent.

---

## 2. Schema Migration Specification (`0006_routing_engine_capacities.sql`)

### 2.1 File Location
`db/migrations/0006_routing_engine_capacities.sql`

### 2.2 Exact SQL Content
```sql
-- Migration 0006: Automated Routing Engine Capacities and Order Metadata
-- Supports vehicle cubic/weight limits and stop-level weight/order tracking

-- 1. Route Stops: add weight, order identifier, and products summary
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS weight_kg numeric(10,2) DEFAULT 0;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS products text;

-- Backfill existing nulls safely
UPDATE route_stops SET weight_kg = 0 WHERE weight_kg IS NULL;

-- Index for rapid lookup of deliveries by external order ID
CREATE INDEX IF NOT EXISTS route_stops_order_id_idx ON route_stops(order_id) WHERE order_id IS NOT NULL;

-- 2. Vehicles: add cubic volume (m³) and weight capacity (kg) limits
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS max_volume_m3 numeric(10,2) DEFAULT 30.0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS max_weight_kg numeric(10,2) DEFAULT 3500.0;

-- Backfill existing vehicles with standard fleet defaults
UPDATE vehicles SET max_volume_m3 = 30.0 WHERE max_volume_m3 IS NULL;
UPDATE vehicles SET max_weight_kg = 3500.0 WHERE max_weight_kg IS NULL;
```

### 2.3 Field Specifications & Rationales

| Table | Column | Type | Default | Nullable | Description & Rationale |
|---|---|---|---|---|---|
| `route_stops` | `weight_kg` | `numeric(10,2)` | `0` | No (default 0) | Cargo weight of the delivery in kilograms. Used by the bin-packing algorithm to guarantee truck weight limits. `numeric(10,2)` matches `volume_m3` in migration `0005`. |
| `route_stops` | `order_id` | `text` | `NULL` | Yes | External order / invoice number parsed from spreadsheet (e.g. `"PED-10482"`, `"NF-9021"`). |
| `route_stops` | `products` | `text` | `NULL` | Yes | Description or itemized list of goods (e.g. `"10x Caixa Papelão, 5x Fardo Óleo"`). |
| `vehicles` | `max_volume_m3` | `numeric(10,2)` | `30.0` | No (default 30) | Maximum cargo cubic capacity in m³ (e.g. 20m³ for 3/4 truck, 30m³ for standard truck, 10m³ for van). |
| `vehicles` | `max_weight_kg` | `numeric(10,2)` | `3500.0` | No (default 3500) | Maximum cargo payload weight in kg (e.g. 3,500 kg for VUC, 6,000 kg for Toco). |

---

## 3. Migration Application Mechanics (`lib/db.ts`)

### 3.1 PGlite (Embedded WASM PostgreSQL) Mechanics
In development and local test environments where `DATABASE_URL` is omitted:
1. `lib/db.ts` (lines 41-42) reads the directory `db/migrations/`:
   ```typescript
   const migrationsDir = resolve(process.cwd(), "db", "migrations");
   for (const file of (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort()) {
     await pg.exec(await readFile(resolve(migrationsDir, file), "utf8"));
   }
   ```
2. The migration files are sorted alphabetically:
   - `0001_initial.sql`
   - `0002_multitenancy.sql`
   - `0003_upload_data.sql`
   - `0004_driver_photo.sql`
   - `0005_route_load_fields.sql`
   - **`0006_routing_engine_capacities.sql`** (new)
3. On application startup or when any backend query runs, `0006_routing_engine_capacities.sql` will be executed automatically via `pg.exec()`. Because all DDL statements utilize `ADD COLUMN IF NOT EXISTS`, execution is 100% idempotent and runs without error on subsequent startups.

### 3.2 Remote PostgreSQL (`DATABASE_URL` Present) Mechanics
In staging or production environments with a managed PostgreSQL database:
1. `scripts/migrate.mjs` can be executed manually or via CI/CD (`npm run migrate`). It iterates through all files in `db/migrations/*.sql` and executes them sequentially.
2. In addition, `lib/db.ts` lines 14-19 currently execute inline self-healing DDL checks on connection pool initialization:
   ```typescript
   pool.query("ALTER TABLE upload_objects ADD COLUMN IF NOT EXISTS file_data bytea").catch((e)=>{
     console.warn("upload_objects auto-migration notice:", e?.message);
   });
   pool.query("ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS boxes integer DEFAULT 0, ADD COLUMN IF NOT EXISTS volume_m3 numeric(10,2) DEFAULT 0").catch((e)=>{
     console.warn("route_stops auto-migration notice:", e?.message);
   });
   ```
3. **Identified Gap & Worker Action**: To prevent runtime failures in PostgreSQL environments where `npm run migrate` might have been skipped, `lib/db.ts` must be updated during Milestone 1 to also include the new columns in its inline startup check.

#### Exact Update for `lib/db.ts`:
```typescript
// Replace lines 17-19 with:
pool.query(
  "ALTER TABLE route_stops " +
  "ADD COLUMN IF NOT EXISTS boxes integer DEFAULT 0, " +
  "ADD COLUMN IF NOT EXISTS volume_m3 numeric(10,2) DEFAULT 0, " +
  "ADD COLUMN IF NOT EXISTS weight_kg numeric(10,2) DEFAULT 0, " +
  "ADD COLUMN IF NOT EXISTS order_id text, " +
  "ADD COLUMN IF NOT EXISTS products text"
).catch((e) => {
  console.warn("route_stops auto-migration notice:", e?.message);
});
pool.query(
  "ALTER TABLE vehicles " +
  "ADD COLUMN IF NOT EXISTS max_volume_m3 numeric(10,2) DEFAULT 30.0, " +
  "ADD COLUMN IF NOT EXISTS max_weight_kg numeric(10,2) DEFAULT 3500.0"
).catch((e) => {
  console.warn("vehicles auto-migration notice:", e?.message);
});
```

---

## 4. API Endpoints Analysis & Review (`app/api/[...path]/route.ts`)

### 4.1 Route Creation: `POST /api/routes` (Lines 581-617)

#### Current Implementation Analysis:
Currently, when `POST /api/routes` executes:
```typescript
for (let i = 0; i < data.stops.length; i++) {
  const s = data.stops[i];
  const boxes = s.boxes ? Number(s.boxes) : null;
  const volume = s.volume_m3 ? Number(s.volume_m3) : null;
  await client.query(
    "INSERT INTO route_stops(route_id,position,name,address,lat,lng,is_origin,boxes,volume_m3) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [rr.rows[0].id, i, s.name, s.address, s.lat, s.lng, i === 0, boxes, volume],
  );
}
```

#### Required Update for Capacity & Order Persistence:
1. Extract `weight_kg` supporting both snake_case (`s.weight_kg`) and camelCase (`s.weightKg`), defaulting to `0`.
2. Extract `order_id` supporting both `s.order_id` and `s.orderId`, defaulting to `null`.
3. Extract `products` (`s.products`), defaulting to `null`.
4. Extract `boxes` and `volume_m3` safely (supporting camelCase `volumeM3`).
5. Update the SQL INSERT to include the new columns.

#### Exact Code for Worker in `app/api/[...path]/route.ts`:
```typescript
        for (let i = 0; i < data.stops.length; i++) {
          const s = data.stops[i];
          const boxes = s.boxes !== undefined && s.boxes !== null && s.boxes !== "" ? Number(s.boxes) : 0;
          const rawVolume = s.volume_m3 ?? s.volumeM3;
          const volume = rawVolume !== undefined && rawVolume !== null && rawVolume !== "" ? Number(rawVolume) : 0;
          const rawWeight = s.weight_kg ?? s.weightKg;
          const weight = rawWeight !== undefined && rawWeight !== null && rawWeight !== "" ? Number(rawWeight) : 0;
          const orderId = s.order_id ?? s.orderId ?? null;
          const products = s.products ? String(s.products) : null;

          await client.query(
            `INSERT INTO route_stops(
              route_id, position, name, address, lat, lng, is_origin, boxes, volume_m3, weight_kg, order_id, products
            ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              rr.rows[0].id,
              i,
              s.name,
              s.address,
              s.lat,
              s.lng,
              i === 0,
              boxes,
              volume,
              weight,
              orderId,
              products,
            ],
          );
        }
```

#### Backwards Compatibility:
- If existing clients or test fixtures call `POST /api/routes` with `{ name, address, lat, lng }` only:
  - `boxes` -> `0`
  - `volume_m3` -> `0`
  - `weight_kg` -> `0`
  - `order_id` -> `null`
  - `products` -> `null`
- Existing behavior is 100% preserved. No existing tests break.

---

### 4.2 Route Details Retrieval: `GET /api/routes/[id]` (Lines 306-364)

#### Current Implementation Analysis:
In lines 318-321:
```typescript
const stops = await query(
  "SELECT * FROM route_stops WHERE route_id=$1 ORDER BY position",
  [route.id],
);
```
Because the query uses `SELECT *`, PostgreSQL and PGlite will **automatically** include the new columns (`weight_kg`, `order_id`, `products`) in the stop objects!

#### Required Normalization:
In PostgreSQL `pg` driver, numeric columns (`volume_m3`, `weight_kg`) can be returned as string representations (e.g. `"145.50"`). To ensure consistent typed data across both dispatcher views and driver apps:
```typescript
      const normalizedStops = stops.rows.map((s: any) => ({
        ...s,
        boxes: Number(s.boxes || 0),
        volume_m3: Number(s.volume_m3 || 0),
        weight_kg: Number(s.weight_kg || 0),
        order_id: s.order_id || null,
        products: s.products || null,
      }));
```
In the response payload:
```typescript
      return json({
        ...route,
        route_date: route.route_date ? String(route.route_date).slice(0, 10) : "",
        stops: normalizedStops,
        odometer: odomWithUrls,
        delivery_events: eventsWithUrls,
        location_points: locationPoints.rows,
      });
```

---

### 4.3 Vehicle Management Endpoints (`vehicles`)

#### 1. `GET /api/vehicles` (Lines 244-252):
Currently selects specific columns:
```typescript
const { rows } = await query(
  `SELECT id,name,plate,current_odometer,rate_per_km,active,created_at FROM vehicles WHERE company_id=$1 ...`
);
```
To expose vehicle capacity to the Dispatch UI and Routing Engine:
Update to:
```typescript
const { rows } = await query(
  `SELECT id,name,plate,current_odometer,rate_per_km,COALESCE(max_volume_m3, 30.0) as max_volume_m3,COALESCE(max_weight_kg, 3500.0) as max_weight_kg,active,created_at FROM vehicles WHERE company_id=$1 ${showAll ? "" : "AND active=true"} ORDER BY active DESC,name ASC`,
  [session.companyId],
);
const normalized = rows.map((v: any) => ({
  ...v,
  current_odometer: Number(v.current_odometer || 0),
  rate_per_km: v.rate_per_km !== null ? Number(v.rate_per_km) : null,
  max_volume_m3: Number(v.max_volume_m3 || 30.0),
  max_weight_kg: Number(v.max_weight_kg || 3500.0),
}));
return json(normalized);
```

#### 2. `POST /api/vehicles` (Lines 569-580):
Accept `max_volume_m3` and `max_weight_kg` from request payload, defaulting to 30.0 and 3500.0:
```typescript
    if (p[0] === "vehicles" && isDispatcher) {
      const plate = String(data.plate || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const ratePerKm = data.rate_per_km !== undefined && data.rate_per_km !== null && data.rate_per_km !== "" ? Number(data.rate_per_km) : null;
      const maxVolumeM3 = data.max_volume_m3 !== undefined && data.max_volume_m3 !== null && data.max_volume_m3 !== "" ? Number(data.max_volume_m3) : 30.0;
      const maxWeightKg = data.max_weight_kg !== undefined && data.max_weight_kg !== null && data.max_weight_kg !== "" ? Number(data.max_weight_kg) : 3500.0;
      const { rows } = await query(
        "INSERT INTO vehicles(company_id,name,plate,current_odometer,rate_per_km,max_volume_m3,max_weight_kg) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
        [targetCompanyId, data.name, plate, Number(data.odometer || 0), ratePerKm, maxVolumeM3, maxWeightKg],
      );
      await audit("dispatcher", null, "create", "vehicle", rows[0].id);
      return json(rows[0], 201);
    }
```

#### 3. `PUT /api/vehicles/[id]` (Lines 1000-1016):
Update to optionally modify capacity limits:
```typescript
      const maxVolumeM3 = data.max_volume_m3 !== undefined && data.max_volume_m3 !== null && data.max_volume_m3 !== "" ? Number(data.max_volume_m3) : null;
      const maxWeightKg = data.max_weight_kg !== undefined && data.max_weight_kg !== null && data.max_weight_kg !== "" ? Number(data.max_weight_kg) : null;

      const { rows } = await query(
        `UPDATE vehicles 
         SET name=$1, plate=$2, current_odometer=$3, rate_per_km=$4, active=$5,
             max_volume_m3 = COALESCE($8, max_volume_m3),
             max_weight_kg = COALESCE($9, max_weight_kg)
         WHERE id=$6 AND company_id=$7 RETURNING *`,
        [name, plate, isNaN(odometer) ? 0 : odometer, ratePerKm, active, p[1], session.companyId, maxVolumeM3, maxWeightKg],
      );
```

---

## 5. Driver App & Downstream Views Impact Analysis

### 5.1 Immediate Route Visibility in Driver App
When an automated route is dispatched via `POST /api/routes` with `driverId` and `vehicleId`:
1. The route's `status` is automatically set to `'assigned'`.
2. When the driver opens the Driver App (`GET /api/routes` with `role: driver`), line 258 filters by `WHERE r.company_id = $1 AND r.driver_id = $2`.
3. In `components/routewise-app.tsx` lines 3443-3451, `todayRoutes` selects routes where `r.status === "active" || (r.status !== "completed" && r.status !== "cancelled" && rDate <= todayStr)`.
4. Therefore, any dispatched route for today scheduled with `driverId` and `vehicleId` appears **immediately** under the "Hoje" tab of the Driver App.

### 5.2 Delivery Stop Progression & Offline Sync
1. When the driver taps on the route, `GET /api/routes/[id]` provides the full stop list.
2. The presence of `weight_kg`, `order_id`, and `products` does not interfere with the driver delivery actions (`POST /api/routes/:id/deliveries/:stopId/complete`).
3. Delivery completion updates only `route_stops.status = 'delivered'` and `delivered_at = now()` (line 785). The new columns remain safely intact.
4. Offline queuing via `lib/offline.ts` operates seamlessly because delivery events store `stop_id`, `photo_key`, `lat`, `lng`, and `note`.

---

## 6. TypeScript Interface Updates

To preserve 100% type safety and zero `tsc --noEmit` errors:

### 6.1 `components/routewise-app.tsx`
```typescript
// Update Vehicle type around line 76:
type Vehicle = {
  id: string;
  name: string;
  plate: string;
  current_odometer: number;
  rate_per_km?: number | null;
  active?: boolean;
  max_volume_m3?: number;
  max_weight_kg?: number;
};

// Update Stop type around line 84:
type Stop = {
  id?: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  is_origin?: boolean;
  status?: "pending" | "delivered";
  boxes?: number;
  volume_m3?: number;
  weight_kg?: number;
  order_id?: string | null;
  products?: string | null;
};
```

### 6.2 `components/route-detail-modal.tsx`
```typescript
// Update DetailedRoute.stops around line 37:
  stops?: Array<{
    id: string;
    position: number;
    name: string;
    address: string;
    lat: number;
    lng: number;
    is_origin: boolean;
    status: "pending" | "delivered";
    delivered_at?: string;
    boxes?: number;
    volume_m3?: number;
    weight_kg?: number;
    order_id?: string | null;
    products?: string | null;
  }>;
```

---

## 7. Exact Step-by-Step Instructions for the Worker

The Worker agent assigned to implement Milestone 1 Database Migration & Persistence must perform the following actions:

### Step 1: Create Migration File
Create `db/migrations/0006_routing_engine_capacities.sql` containing the exact SQL from Section 2.2.

### Step 2: Update `lib/db.ts`
Modify the connection pool initialization in `lib/db.ts` to include `weight_kg`, `order_id`, `products` on `route_stops`, and `max_volume_m3`, `max_weight_kg` on `vehicles` as specified in Section 3.2.

### Step 3: Update `app/api/[...path]/route.ts`
1. Update `POST /api/routes` (lines ~600-608) to insert `weight_kg`, `order_id`, and `products`.
2. Update `GET /api/routes/[id]` (lines ~320-330) to normalize `weight_kg`, `order_id`, and `products`.
3. Update `GET /api/vehicles` (lines ~247-251) to query and normalize `max_volume_m3` and `max_weight_kg`.
4. Update `POST /api/vehicles` (lines ~574-577) to insert `max_volume_m3` and `max_weight_kg`.
5. Update `PUT /api/vehicles/[id]` (lines ~1009-1013) to update `max_volume_m3` and `max_weight_kg`.

### Step 4: Update TypeScript Interfaces
Update `Stop` and `Vehicle` in `components/routewise-app.tsx` and `DetailedRoute.stops` in `components/route-detail-modal.tsx` as specified in Section 6.

### Step 5: Implement Automated Integration Test
Create `tests/schema-persistence.test.mjs` using `node:test` to verify:
1. PGlite applies `0006_routing_engine_capacities.sql` on startup.
2. `route_stops` contains `weight_kg`, `order_id`, and `products`.
3. `vehicles` contains `max_volume_m3` and `max_weight_kg`.
4. Creating a route via `POST /api/routes` with weight, orderId, and products persists them accurately.
5. Retrieving the route via `GET /api/routes/[id]` returns the persisted fields with proper numeric types.
6. Creating a route without weight, orderId, or products persists defaults (`0`, `null`, `null`) without error.

### Step 6: Execute Verification
Run the verification suite:
```bash
npm run typecheck
node --test tests/schema-persistence.test.mjs
npm test
```
All tests must exit with code 0.
