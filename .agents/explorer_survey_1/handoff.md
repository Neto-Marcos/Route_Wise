# Handoff Report: Database Schema & Driver App Data Flow Survey

**Agent**: Explorer Survey 1
**Role**: Teamwork Explorer (Investigation & Synthesis)
**Target Milestone**: Automated Routing Engine Survey
**Artifact Reference**: `survey_schema_driver.md`

---

## 1. Observation

1. **Dependency Analysis (`package.json`)**:
   - `package.json` line 1:
     ```json
     {"name":"routewise","version":"2.0.0","private":true,"scripts":{"dev":"next dev","build":"next build","start":"next start","migrate":"node scripts/migrate.mjs","typecheck":"tsc --noEmit","test":"node --test tests/offline-photo-queue.test.mjs"},"dependencies":{"@aws-sdk/client-s3":"^3.888.0","@aws-sdk/s3-request-presigner":"^3.888.0","@electric-sql/pglite":"^0.3.10","bcryptjs":"^3.0.2","jose":"^6.1.0","leaflet":"^1.9.4","lucide-react":"^0.544.0","next":"^15.5.3","pg":"^8.16.3","react":"^19.1.1","react-dom":"^19.1.1","sharp":"^0.35.4","zod":"^4.1.8"},"devDependencies":{"@types/leaflet":"^1.9.20","@types/node":"^24.3.1","@types/pg":"^8.15.5","@types/react":"^19.1.12","@types/react-dom":"^19.1.9","typescript":"^5.9.2"},"packageManager":"pnpm@10.15.1"}
     ```
   - Observed that neither `drizzle-orm` nor `drizzle-kit` is present in dependencies or devDependencies.
   - Observed that no spreadsheet parser (e.g., `xlsx`, `papaparse`) is currently installed.
   - Observed that test runner is Node.js built-in (`node --test`), not Vitest or Jest.

2. **Database Connection & Migration Setup (`lib/db.ts` & `db/migrations/`)**:
   - `lib/db.ts` lines 9-22: Uses `pg.Pool` when `process.env.DATABASE_URL` is set.
   - `lib/db.ts` lines 23-48: Uses `@electric-sql/pglite` (storing in `.local-db/routewise`) when `process.env.DATABASE_URL` is absent.
   - `lib/db.ts` lines 41-42: Automatically applies all SQL migrations in `db/migrations/*.sql` alphabetically upon initialization in local mode:
     ```typescript
     const migrationsDir = resolve(process.cwd(), "db", "migrations");
     for (const file of (await readdir(migrationsDir)).filter(f => f.endsWith(".sql")).sort())
       await pg.exec(await readFile(resolve(migrationsDir, file), "utf8"));
     ```
   - 5 SQL migrations present in `db/migrations/`:
     - `0001_initial.sql`: Core tables (`drivers`, `vehicles`, `routes`, `route_stops`, `upload_objects`, `odometer_readings`, `delivery_events`, `location_points`, `sync_operations`, `audit_log`).
     - `0002_multitenancy.sql`: `companies`, `dispatchers`, adds `company_id` to `drivers`, `vehicles`, `routes`.
     - `0003_upload_data.sql`: Adds `file_data bytea` to `upload_objects`.
     - `0004_driver_photo.sql`: Adds `photo text` to `drivers`.
     - `0005_route_load_fields.sql`: Adds `boxes integer DEFAULT 0` and `volume_m3 numeric(10,2) DEFAULT 0` to `route_stops`.

3. **Current Tables & Capacities**:
   - Table `routes` has columns: `id`, `public_id`, `company_id`, `name`, `route_date`, `status`, `optimize_by`, `circular`, `driver_id`, `vehicle_id`, `estimated_km`, `actual_km`, `started_at`, `finished_at`, `cancelled_at`, `created_at`.
   - Table `route_stops` has columns: `id`, `route_id`, `position`, `name`, `address`, `lat`, `lng`, `is_origin`, `status`, `delivered_at`, `boxes`, `volume_m3`.
   - Observation: Column `weight_kg` is not present in `route_stops`.
   - Table `vehicles` has columns: `id`, `company_id`, `name`, `plate`, `current_odometer`, `rate_per_km`, `active`, `created_at`.
   - Observation: Columns `max_volume_m3` and `max_weight_kg` are not present in `vehicles`.

4. **Driver App Data Flow & Display (`components/routewise-app.tsx` & `app/api/[...path]/route.ts`)**:
   - Driver query in `app/api/[...path]/route.ts` lines 258-261:
     ```typescript
     if (session.role === "driver") {
       values.push(session.driverId);
       conditions.push(`r.driver_id=$${values.length}`);
     }
     ```
   - Tab filtering in `components/routewise-app.tsx` lines 3443-3451:
     ```typescript
     const todayRoutes = useMemo(() => {
       return routes.filter((r) => {
         const rDate = String(r.route_date || "").slice(0, 10);
         return (
           r.status === "active" ||
           (r.status !== "completed" && r.status !== "cancelled" && rDate <= todayStr)
         );
       });
     }, [routes, todayStr]);
     ```
   - Route status progression: `'draft'` -> `'assigned'` -> `'active'` -> `'completed'`.
   - Inserting a route with both `driverId` and `vehicleId` automatically sets `status = 'assigned'`. When `route_date <= todayStr`, the route immediately renders in the driver's "Hoje" tab.

5. **Offline Queue & Photo Compression (`lib/offline.ts`, `lib/driver-photo.ts`)**:
   - `lib/offline.ts`: IndexedDB database `routewise-offline`, store `operations`. All payloads queued with unique `idempotencyKey`.
   - Server endpoints verify `ON CONFLICT (operation_id) DO NOTHING` or verify duplicate deliveries and return 200/409 idempotently.
   - Photos compressed to WebP (max 1600x1200, quality 0.70) strictly < 350KB before transmission or IndexedDB storage.

6. **Test Suite Execution**:
   - Executed `npm test` (`node --test tests/offline-photo-queue.test.mjs`):
     Output: `ℹ tests 24 | ℹ suites 4 | ℹ pass 24 | ℹ fail 0 | ℹ duration_ms 2672.9ms`.
   - Executed `npm run typecheck` (`tsc --noEmit`):
     Output: Exited with code 0 (clean, no type errors).

---

## 2. Logic Chain

1. **Premise 1**: The user request specifies implementing an Automated Routing Engine that clusters deliveries by volume (m³) and weight (kg), assigning routes to drivers and saving to the database using Drizzle ORM.
2. **Premise 2**: Direct inspection of `package.json`, `lib/db.ts`, and full-codebase grep confirms that **Drizzle ORM is not installed and has never been used** in this project. The system uses raw parameterized SQL over PostgreSQL (`pg.Pool` or `@electric-sql/pglite`).
3. **Inference 1**: Implementing database mutations using `lib/db.ts` and standard SQL transactions is the most coherent, backward-compatible, and zero-risk path forward. Alternatively, if Drizzle ORM is explicitly demanded by the orchestrator, both `drizzle-orm` and `drizzle-kit` would need to be installed and configured from scratch.
4. **Premise 3**: The user request requires clustering based on volume (m³) and weight (kg), but table `route_stops` only has `boxes` and `volume_m3` (added in `0005_route_load_fields.sql`). Table `vehicles` does not store vehicle volume or weight capacities.
5. **Inference 2**: A new migration (e.g. `0006_routing_engine_capacities.sql`) adding `weight_kg` to `route_stops` and standard capacity columns (`max_volume_m3`, `max_weight_kg`) to `vehicles` (or defaulting to standard parameters such as 20m³/30m³ in the engine) is necessary for full mathematical compliance.
6. **Premise 4**: Analysis of `components/routewise-app.tsx` and `app/api/[...path]/route.ts` confirms that when a route is inserted with `driver_id` and `vehicle_id`, its status becomes `'assigned'`. The Driver App filters `r.status !== 'completed' && r.status !== 'cancelled' && rDate <= todayStr`.
7. **Inference 3**: "Save and Dispatch" can simply invoke the existing `POST /api/routes` endpoint (or a batch dispatch variant) passing `{ driverId, vehicleId, routeDate: today, stops: [...] }`, and the route will instantly appear on the assigned driver's active dashboard.

---

## 3. Caveats

- **No Spreadsheet Parser Currently Installed**: Neither `.xlsx` nor `.csv` parsing library exists in `package.json`. A library such as `xlsx` or native parsing logic will need to be introduced by the implementation agent.
- **Geocoding Dependency**: If uploaded spreadsheet rows only contain text addresses without coordinates (`lat`/`lng`), the system will need to geocode them (via Nominatim or existing address caches) before clustering and OSRM optimization.
- **Front-End Scope**: Detailed UI mockups for the spreadsheet dropzone were surveyed at the data flow level, but visual layout implementation belongs to the UI/clustering workstream.

---

## 4. Conclusion

- The database architecture is robust and ready for routing engine integration, utilizing PostgreSQL with local PGlite fallback.
- The project does not currently use Drizzle ORM; the implementation team should either continue with the proven `lib/db.ts` parameterized SQL transactional pattern (recommended) or explicitly install and set up Drizzle ORM if mandated.
- Route dispatching to the Driver App requires inserting a `routes` record with `status = 'assigned'`, `driver_id`, and `vehicle_id`, followed by sequential `route_stops` records (`position = 0` for origin CD, `position = 1..N` for deliveries).
- LIFO (Last In, First Out) loading instructions must display the delivery stops in reverse sequence (Stop N down to Stop 1) for physical truck loading.
- Test runner is Node's built-in `node:test` (`npm test`), passing all 24 tests.

---

## 5. Verification Method

To independently verify all claims made in this report:

1. **Verify Drizzle ORM Absence**:
   ```bash
   grep -rn "drizzle" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next
   # Confirms 0 occurrences
   ```

2. **Verify Existing Tests Pass**:
   ```bash
   npm test
   # Runs: node --test tests/offline-photo-queue.test.mjs
   # Expect: 24 passed tests in ~2.6s
   ```

3. **Verify TypeScript Compilation**:
   ```bash
   npm run typecheck
   # Runs: tsc --noEmit
   # Expect: Exit code 0
   ```

4. **Inspect Database Schema**:
   Review `db/migrations/0001_initial.sql` through `0005_route_load_fields.sql` to confirm table column definitions.

5. **Inspect Driver App Tab Logic**:
   Review lines 3443-3467 in `components/routewise-app.tsx` to confirm the `todayRoutes` and `upcomingRoutes` criteria.

6. **Invalidation Conditions**:
   - This report would be invalidated if a Drizzle ORM schema exists outside the repository root or on another branch.
   - Invalidation occurs if the Driver App requires additional handshake mutations beyond setting `status = 'assigned'` and `driver_id`.
