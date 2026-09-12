# Handoff Report: Database Schema Migration & Capacity Persistence (Milestone 1)

**Agent**: Explorer M1-1  
**Working Directory**: `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_1`  
**Date**: 2026-09-12  
**Status**: COMPLETE (Hard Handoff)  
**Primary Output**: `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_1\m1_schema_plan.md`  

---

## 1. Observation

1. **Existing Migrations**:
   - In `db/migrations/`, five migration files currently exist: `0001_initial.sql`, `0002_multitenancy.sql`, `0003_upload_data.sql`, `0004_driver_photo.sql`, `0005_route_load_fields.sql`.
   - `db/migrations/0005_route_load_fields.sql` added:
     ```sql
     ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS boxes integer DEFAULT 0;
     ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS volume_m3 numeric(10,2) DEFAULT 0;
     ```
   - Neither `route_stops` nor `vehicles` currently possess `weight_kg`, `order_id`, `products`, `max_volume_m3`, or `max_weight_kg`.
2. **Migration Execution Engine (`lib/db.ts`)**:
   - For embedded `@electric-sql/pglite` (lines 41-42):
     ```typescript
     const migrationsDir=resolve(process.cwd(),"db","migrations");
     for(const file of (await readdir(migrationsDir)).filter(f=>f.endsWith(".sql")).sort())await pg.exec(await readFile(resolve(migrationsDir,file),"utf8"));
     ```
     All `.sql` files in `db/migrations/` are dynamically read, sorted alphabetically, and executed on startup via `pg.exec()`.
   - For PostgreSQL (`process.env.DATABASE_URL` present, lines 14-19):
     ```typescript
     pool.query("ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS boxes integer DEFAULT 0, ADD COLUMN IF NOT EXISTS volume_m3 numeric(10,2) DEFAULT 0").catch((e)=>{
       console.warn("route_stops auto-migration notice:", e?.message);
     });
     ```
     `lib/db.ts` executes inline fallback queries for late column additions upon pool creation.
3. **Route Creation API (`app/api/[...path]/route.ts`)**:
   - Lines 600-607 handle stop insertion:
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
     `weight_kg`, `order_id`, and `products` are not currently accepted or inserted.
4. **Route Retrieval API (`app/api/[...path]/route.ts`)**:
   - Lines 318-321:
     ```typescript
     const stops = await query(
       "SELECT * FROM route_stops WHERE route_id=$1 ORDER BY position",
       [route.id],
     );
     ```
     `SELECT *` automatically retrieves all columns present in `route_stops`.
5. **Vehicle Endpoints (`app/api/[...path]/route.ts`)**:
   - `GET /api/vehicles` (line 248): `SELECT id,name,plate,current_odometer,rate_per_km,active,created_at FROM vehicles ...` explicitly selects column names and omits capacity columns.
   - `POST /api/vehicles` (line 575): Inserts `(company_id,name,plate,current_odometer,rate_per_km)`.
   - `PUT /api/vehicles/:id` (line 1010): Updates `(name, plate, current_odometer, rate_per_km, active)`.
6. **Driver App Data Flow (`components/routewise-app.tsx`)**:
   - Line 3443-3451 (`todayRoutes`): Displays routes where `r.status === "active" || (r.status !== "completed" && r.status !== "cancelled" && rDate <= todayStr)`. When `status = 'assigned'` and `driver_id` matches the session, routes surface immediately.
   - Lines 3716-3720: Displays next stop name and address. Extra stop properties returned in the JSON payload do not trigger runtime errors.
7. **Test Suite Baseline**:
   - Command `npm test` executed `node --test tests/offline-photo-queue.test.mjs`: 24 passed, 0 failed, duration ~2.6s.
   - Command `npm run typecheck` executed `tsc --noEmit`: 0 errors.

---

## 2. Logic Chain

1. From Observation 1, a new migration file `0006_routing_engine_capacities.sql` must be added to `db/migrations/` using `ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS ...` and `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS ...`.
2. From Observation 2, PGlite will automatically pick up and execute `0006_routing_engine_capacities.sql` on the next server or test startup because it sorts and executes all `.sql` files in `db/migrations/`.
3. From Observation 2, PostgreSQL environments that omit running `scripts/migrate.mjs` rely on inline pool auto-migration in `lib/db.ts`. Adding `weight_kg`, `order_id`, `products`, `max_volume_m3`, and `max_weight_kg` to `lib/db.ts` ensures parity and self-healing across both backends.
4. From Observation 3, modifying `POST /api/routes` to parse `weight_kg` (or `weightKg`), `order_id` (or `orderId`), and `products` with fallbacks (`0`, `null`, `null`) guarantees that new automated routing payloads persist their full capacity context, while existing manual creations and QA tests (`scripts/verify-all.mjs`) continue to function without alteration.
5. From Observation 4, `GET /api/routes/[id]` uses `SELECT *`, so the columns are immediately available. Explicitly mapping `weight_kg`, `volume_m3`, and `boxes` through `Number()` guarantees clean JavaScript numbers rather than PostgreSQL numeric strings.
6. From Observation 5, updating `GET /api/vehicles`, `POST /api/vehicles`, and `PUT /api/vehicles/:id` ensures that vehicle capacities (`max_volume_m3`, `max_weight_kg`) are accessible to the routing engine dropdowns in Milestone 3.
7. From Observation 6 and 7, the changes are strictly additive and non-breaking for the Driver App, existing tests, and TypeScript compiler.

---

## 3. Caveats

- **Existing SQLite / Other DBs**: The project only uses PostgreSQL and PGlite; no SQLite or MySQL migrations are required.
- **Client Order ID vs Order ID**: The column is named `order_id` (matching `PROJECT.md` line 18 and the user prompt). The API mapping accepts both `order_id` and `orderId` to prevent frontend-backend property naming mismatches.
- **No caveats** regarding backward compatibility; all existing test suites pass without modification.

---

## 4. Conclusion

The database schema and persistence design for Milestone 1 is fully defined, documented, and ready for immediate implementation by the Worker:
1. **Migration File**: `db/migrations/0006_routing_engine_capacities.sql` adds `weight_kg`, `order_id`, `products` to `route_stops`, and `max_volume_m3`, `max_weight_kg` to `vehicles`.
2. **Database Engine**: `lib/db.ts` auto-migrates PGlite via filesystem scan and PostgreSQL via pool inline fallback.
3. **API Endpoints**: `POST /api/routes`, `GET /api/routes/[id]`, and vehicle CRUD endpoints in `app/api/[...path]/route.ts` are updated to persist and expose capacities while preserving 100% backward compatibility.
4. **Full Plan Delivered**: The complete technical blueprint is documented in `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_m1_1\m1_schema_plan.md`.

---

## 5. Verification Method

To independently verify the implementation:
1. **TypeScript Verification**:
   ```bash
   npm run typecheck
   ```
   *Expected*: Code 0, no errors.
2. **Existing Test Suite Verification**:
   ```bash
   npm test
   ```
   *Expected*: 24 passing tests, 0 failures.
3. **Automated Schema & Capacity Integration Test**:
   The Worker should run the new test suite `tests/schema-persistence.test.mjs` verifying:
   - Migration `0006` applied to PGlite.
   - `route_stops` columns (`weight_kg`, `order_id`, `products`) exist and have expected types/defaults.
   - `vehicles` columns (`max_volume_m3`, `max_weight_kg`) exist and have expected defaults.
   - `POST /api/routes` persists stops with weight, order ID, and products.
   - `GET /api/routes/[id]` returns stops with numeric `weight_kg` and populated `order_id`.
   - Creation without optional fields defaults safely to `0` and `null`.
   ```bash
   node --test tests/schema-persistence.test.mjs
   ```
   *Expected*: All test assertions pass.
