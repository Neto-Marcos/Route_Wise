# Survey Report: Database Schema & Driver App Data Flow
**Component**: Criar Rota TMS (RouteWise)
**Feature Focus**: Automated Routing Engine & Dispatch Integration
**Author**: Explorer Survey 1
**Date**: 2026-09-12
**Integrity Mode**: Development

---

## Executive Summary
This survey details the database architecture, runtime environment, Driver App data pipeline, offline synchronization, and test frameworks in Criar Rota TMS (`RouteWise`). 

**Key Architectural Findings**:
1. **Database & ORM Discrepancy**: The codebase does **not** currently use Drizzle ORM. Database interactions are built on raw parameterized SQL queries executed through `lib/db.ts`, connecting either to a standard PostgreSQL cluster via `pg.Pool` (when `DATABASE_URL` is set) or an embedded WebAssembly PostgreSQL instance via `@electric-sql/pglite` (when `DATABASE_URL` is absent). Migrations are plain `.sql` files in `db/migrations/` (0001 to 0005).
2. **Current Route & Stop Schema**: Existing tables `routes` and `route_stops` already support multi-tenancy (`company_id`), geolocation coordinates (`lat`, `lng`), sequence positions (`position`), package count (`boxes`), and cubic volume (`volume_m3`). However, **weight (`weight_kg`)** and vehicle capacity limits (`max_volume_m3`, `max_weight_kg`) are not yet materialized columns in PostgreSQL.
3. **Driver App Data Flow**: The driver portal queries `/api/routes` with role header `X-RouteWise-Role: driver`. A route becomes immediately visible in the driver's "Hoje" tab as soon as `driver_id` and `vehicle_id` are set and its `status` is `'assigned'`.
4. **Offline Resilience & POD**: `lib/offline.ts` provides an idempotent offline queue in IndexedDB (`routewise-offline`, store `operations`), backed by WebP client-side photo compression (`lib/driver-photo.ts`).
5. **Testing Architecture**: Test infrastructure uses Node.js's native test runner (`node:test`) and `node:assert/strict`. No Vitest or Jest dependencies exist. All 24 test cases pass cleanly.

---

## 1. Project Structure & Runtime Environment

### Directory Structure Overview
```
Route_Wise/
├── app/
│   ├── api/
│   │   ├── [...path]/route.ts       # Central catch-all REST API router (1,108 lines)
│   │   └── routes/route.ts          # Alias router delegating to [...path]
│   ├── globals.css                  # Master stylesheet (Tailwind & custom UI classes)
│   ├── layout.tsx                   # HTML root layout, metadata, viewport
│   ├── offline/page.tsx             # Fallback offline page
│   └── page.tsx                     # Main entry rendering <RouteWiseApp />
├── components/
│   ├── driver-live-map.tsx          # Leaflet GPS tracking map for driver
│   ├── live-fleet-map.tsx           # Leaflet fleet map for dispatch manager
│   ├── route-detail-modal.tsx       # Route overview & timeline modal
│   ├── route-report-modal.tsx       # PDF / printable trip sheet modal
│   └── routewise-app.tsx            # Monolithic SPA component (4,415 lines)
├── db/
│   └── migrations/                  # Plain SQL migration files
│       ├── 0001_initial.sql
│       ├── 0002_multitenancy.sql
│       ├── 0003_upload_data.sql
│       ├── 0004_driver_photo.sql
│       └── 0005_route_load_fields.sql
├── lib/
│   ├── auth.ts                      # JWT session handling via `jose` and HTTP cookies
│   ├── db.ts                        # Dual pg / PGlite database connector & audit logger
│   ├── driver-photo.ts              # WebP compression & canvas manipulation
│   ├── offline.ts                   # Idempotent IndexedDB offline queue & drain worker
│   ├── print-document.ts            # Hidden iframe printing helper
│   └── storage.ts                   # AWS S3 presigner / fallback local upload URLs
├── scripts/
│   ├── migrate.mjs                  # Standalone migration runner for remote Postgres
│   └── verify-all.mjs               # E2E test verification script
├── tests/
│   └── offline-photo-queue.test.mjs # Automated suite using node:test
├── package.json
└── tsconfig.json
```

### Runtime & Dependency Specifications (`package.json`)
- **Node.js Environment**:
  - Target: Node.js >= 20.x
  - API Routes declare: `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
- **Framework**: Next.js `^15.5.3` (App Router), React `^19.1.1`, React DOM `^19.1.1`, TypeScript `^5.9.2`.
- **Package Manager**: `pnpm@10.15.1`.
- **Database Drivers**:
  - `pg` (`^8.16.3`): PostgreSQL pool client for production / staging environments with `DATABASE_URL`.
  - `@electric-sql/pglite` (`^0.3.10`): In-process PostgreSQL compiled to WASM/native, used automatically in development when `DATABASE_URL` is omitted. Stores state in `.local-db/routewise`.
- **Media & Processing**:
  - `sharp` (`^0.35.4`): Server-side image processing.
  - `leaflet` (`^1.9.4`): Client-side interactive mapping.
- **Security & Validation**:
  - `bcryptjs` (`^3.0.2`): Password and PIN hashing (cost factor 10).
  - `jose` (`^6.1.0`): JWT token issuance and cookie verification.
  - `zod` (`^4.1.8`): Schema validation.
- **Storage**:
  - `@aws-sdk/client-s3` (`^3.888.0`) & `@aws-sdk/s3-request-presigner` (`^3.888.0`).
- **Icons**: `lucide-react` (`^0.544.0`).
- **Spreadsheet Parsers**: **Currently none installed**. Parsing `.xlsx` or `.csv` will require adding a parser (e.g. `xlsx`, `papaparse`) or writing a native CSV parser.

---

## 2. Drizzle ORM Investigation & Current Database Layer

### Critical Finding: Absence of Drizzle ORM
Despite the mention of Drizzle ORM in user requirement prompts:
- Neither `drizzle-orm` nor `drizzle-kit` is installed in `package.json`.
- There are no Drizzle schema files (`schema.ts`), relational query definitions, or `drizzle.config.ts`.
- All database queries throughout the app (in `lib/db.ts` and `app/api/[...path]/route.ts`) execute **direct SQL parameterized queries**.

### Existing Database Architecture (`lib/db.ts`)
`lib/db.ts` exposes three primary primitives:
1. `export const db = { connect: backend }`: Returns a database client with `{ query: (text, values) => Promise<{ rows: T[] }>, release: () => void }`.
2. `export async function query<T>(text: string, values: unknown[] = [])`: Executes a single parameterized query.
3. `export async function audit(actorType, actorId, action, entityType, entityId, details)`: Appends an entry to `audit_log`.

#### Dual Backend Mechanism:
- **Production Mode (`DATABASE_URL` present)**:
  - Creates a singleton `pg.Pool` with `max: 8`.
  - Automatically runs idempotent `ALTER TABLE` checks for late column additions.
- **Local Embedded Mode (`DATABASE_URL` absent)**:
  - Initializes `PGlite` on `.local-db/routewise`.
  - Cleans up stale `postmaster.pid` if present.
  - Automatically iterates through all files in `db/migrations/*.sql` alphabetically and executes `pg.exec()` on each at startup.

### Migration Management
- Directory: `db/migrations/`
- Standard: Plain SQL statements with `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.
- Applied via `node scripts/migrate.mjs` (for remote PostgreSQL) or automatically on local startup (via `lib/db.ts`).

### Integration Strategy for the Routing Engine
Two architectural paths exist for implementing the new routing engine:
- **Option A (Recommended for Consistency)**: Implement the Automated Routing Engine using the existing parameterized SQL pattern via `lib/db.ts` (`BEGIN`, `INSERT INTO routes ...`, loop `INSERT INTO route_stops ...`, `COMMIT`). This requires zero new dependencies, preserves 100% compatibility with both `pg` and `@electric-sql/pglite`, and avoids mixing ORM paradigms.
- **Option B (If Drizzle ORM is strictly mandated)**: Install `drizzle-orm` and `drizzle-kit`, configure `drizzle.config.ts`, define schema tables in `db/schema.ts`, and adapt `lib/db.ts` to export a Drizzle instance wrapping the `pg` pool / PGlite.

---

## 3. Database Schema & Tables Detailed Specification

Below is the complete catalog of all 11 tables currently defined in the schema across migrations `0001` through `0005`.

### 3.1. `companies` (Multi-Tenancy)
*Source: `db/migrations/0002_multitenancy.sql`*

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Tenant identifier |
| `code` | `text` | `UNIQUE NOT NULL` | Uppercase corporate code (e.g. `LEGADO`, `ABC-123`) |
| `name` | `text` | `NOT NULL` | Company display name |
| `active` | `boolean` | `NOT NULL DEFAULT true` | Active flag |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

### 3.2. `dispatchers` (Manager Users)
*Source: `db/migrations/0002_multitenancy.sql`*

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Dispatcher identifier |
| `company_id` | `uuid` | `NOT NULL REFERENCES companies(id)` | Tenant foreign key |
| `name` | `text` | `NOT NULL` | Full name |
| `email` | `text` | `NOT NULL` | Login email |
| `password_hash` | `text` | `NOT NULL` | Bcrypt password hash |
| `active` | `boolean` | `NOT NULL DEFAULT true` | Active status |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Registration timestamp |

*Constraints*: `UNIQUE(company_id, email)`.

### 3.3. `drivers` (Motoristas)
*Source: `db/migrations/0001_initial.sql`, `0002_multitenancy.sql`, `0004_driver_photo.sql`*

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Internal driver ID |
| `public_id` | `uuid` | `UNIQUE NOT NULL DEFAULT gen_random_uuid()` | Public shareable ID |
| `company_id` | `uuid` | `NOT NULL REFERENCES companies(id)` | Tenant foreign key |
| `name` | `text` | `NOT NULL` | Driver name |
| `phone` | `text` | Nullable | Contact phone number |
| `pin_hash` | `text` | `NOT NULL` | Bcrypt hash of numeric 4-8 digit PIN |
| `photo` | `text` | Nullable | Base64 data URL or storage URL |
| `active` | `boolean` | `NOT NULL DEFAULT true` | Status flag |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

*Indexes*: `drivers_company_idx ON drivers(company_id)`.

### 3.4. `vehicles` (Frota)
*Source: `db/migrations/0001_initial.sql`, `0002_multitenancy.sql`*

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Vehicle identifier |
| `company_id` | `uuid` | `NOT NULL REFERENCES companies(id)` | Tenant foreign key |
| `name` | `text` | `NOT NULL` | Vehicle model / label (e.g., "Van Fiorino") |
| `plate` | `text` | `NOT NULL` | License plate (alphanumeric uppercase) |
| `current_odometer` | `numeric(12,1)` | `NOT NULL DEFAULT 0` | Current km counter |
| `rate_per_km` | `numeric(12,2)` | Nullable | Cost rate per km for trip calculation |
| `active` | `boolean` | `NOT NULL DEFAULT true` | Status flag |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

*Indexes*: Unique index `vehicles_company_plate_key ON vehicles(company_id, plate)`.
*Note on Capacities*: `vehicles` does not currently store `max_volume_m3` or `max_weight_kg`.

### 3.5. `routes` (Rotas)
*Source: `db/migrations/0001_initial.sql`, `0002_multitenancy.sql`*

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Route primary key |
| `public_id` | `uuid` | `UNIQUE NOT NULL DEFAULT gen_random_uuid()` | Public tracking ID |
| `company_id` | `uuid` | `NOT NULL REFERENCES companies(id)` | Tenant foreign key |
| `name` | `text` | `NOT NULL` | Route title |
| `route_date` | `date` | `NOT NULL` | Scheduled execution date |
| `status` | `text` | `CHECK(status IN ('draft','assigned','active','completed','cancelled'))` | Default `'draft'` |
| `optimize_by` | `text` | `NOT NULL DEFAULT 'distance'` | Optimization strategy (`distance`, `time`, `manual`) |
| `circular` | `boolean` | `NOT NULL DEFAULT false` | Whether route returns to origin CD |
| `driver_id` | `uuid` | `REFERENCES drivers(id)` (Nullable) | Assigned driver |
| `vehicle_id` | `uuid` | `REFERENCES vehicles(id)` (Nullable) | Assigned vehicle |
| `estimated_km` | `numeric(12,2)` | Nullable | Calculated itinerary distance |
| `actual_km` | `numeric(12,1)` | Nullable | Measured difference between final and initial odometer |
| `started_at` | `timestamptz` | Nullable | Timestamp when driver registered start odometer |
| `finished_at` | `timestamptz` | Nullable | Timestamp when driver completed final odometer |
| `cancelled_at` | `timestamptz` | Nullable | Cancellation timestamp |
| `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Creation timestamp |

*Indexes*: `routes_company_idx ON routes(company_id, route_date DESC)`.

### 3.6. `route_stops` (Paradas e Entregas)
*Source: `db/migrations/0001_initial.sql`, `0005_route_load_fields.sql`*

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | Stop identifier |
| `route_id` | `uuid` | `NOT NULL REFERENCES routes(id) ON DELETE CASCADE` | Parent route |
| `position` | `integer` | `NOT NULL` | Sequence index (0 = origin CD, 1..N = deliveries) |
| `name` | `text` | `NOT NULL` | Client / recipient name |
| `address` | `text` | `NOT NULL` | Formatted street address |
| `lat` | `double precision` | `NOT NULL` | Latitude coordinate |
| `lng` | `double precision` | `NOT NULL` | Longitude coordinate |
| `is_origin` | `boolean` | `NOT NULL DEFAULT false` | True for starting depot / distribution center |
| `status` | `text` | `CHECK(status IN ('pending','delivered'))` | Default `'pending'` |
| `delivered_at` | `timestamptz` | Nullable | Delivery completion timestamp |
| `boxes` | `integer` | `DEFAULT 0` | Item count / packages (from migration 0005) |
| `volume_m3` | `numeric(10,2)` | `DEFAULT 0` | Cubic volume in m³ (from migration 0005) |

*Constraints*: `UNIQUE(route_id, position)`.
*Note on Weight*: `weight_kg` is currently missing from `route_stops`. Adding it requires an `ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS weight_kg numeric(10,2) DEFAULT 0;`.

### 3.7. Supporting Tables
- **`upload_objects`**: Stores photo metadata and binary byte content (`file_data bytea`) for offline/local resilience.
- **`odometer_readings`**: `route_id`, `phase ('start' | 'finish')`, `kilometers`, `photo_key`, `lat`, `lng`, `recorded_at`. `UNIQUE(route_id, phase)`.
- **`delivery_events`**: `operation_id` (UUID unique for idempotency), `route_id`, `stop_id`, `photo_key`, `note`, `lat`, `lng`, `delivered_at`.
- **`location_points`**: GPS breadcrumbs with `operation_id` (unique), `route_id`, `driver_id`, `lat`, `lng`, `accuracy`, `recorded_at`.
- **`sync_operations`**: Records processed synchronization batch IDs.
- **`audit_log`**: System auditing for dispatcher and driver mutations.

---

## 4. Driver App Architecture & Data Flow

### 4.1. Driver Authentication & Session
1. **Login Flow**:
   - Driver selects driver profile in UI or inputs PIN.
   - Request to `POST /api/session/driver` with `{ driverId, password: pin, companyCode? }`.
   - Server checks `bcrypt.compare(pin, driver.pin_hash)`.
   - On success: Issues HTTP-only cookie `rw_driver_session` signed with `jose` (JWT containing `{ role: "driver", driverId, companyId }`) with 12-hour expiration.
   - Client stores `sessionStorage.setItem("rw_role", "driver")`.

### 4.2. Route Querying & Filtering
Inside `components/routewise-app.tsx`, `DriverApp` triggers:
```typescript
const load = useCallback(() => api("/api/routes").then(setRoutes), []);
```
On the server (`app/api/[...path]/route.ts` lines 258-261):
- When `session.role === "driver"`, the query automatically appends:
  ```sql
  WHERE r.company_id = $1 AND r.driver_id = $2
  ```
- Resulting rows include:
  - Aggregate subqueries: `deliveries` (count of stops where `NOT s.is_origin AND s.position > 0`) and `delivered` (count of stops where `s.status = 'delivered'`).
  - Vehicle details: `vehicle_name`, `plate`, `vehicle_odometer`.

### 4.3. Driver Portal Tabs
The driver UI splits routes into three tabs:
1. **Hoje (`today`)**:
   - Criteria: `r.status === "active" || (r.status !== "completed" && r.status !== "cancelled" && rDate <= todayStr)`
   - Any route with `status = 'assigned'` scheduled for today or earlier immediately appears here.
2. **Próximas (`upcoming`)**:
   - Criteria: `r.status !== "completed" && r.status !== "cancelled" && rDate > todayStr`
   - Future scheduled routes.
3. **Concluídas (`completed`)**:
   - Criteria: `r.status === "completed" || r.status === "cancelled"`

### 4.4. Active Route Lifecycle & Progression
When a driver taps on a route, `api("/api/routes/${r.id}")` loads the complete route graph (stops, odometer readings, delivery events). The driver navigates through three distinct phases:

```
[assigned] -> (Driver takes Start Odometer Photo + km) -> [active]
[active]   -> (Driver completes stops 1..N with Proof Photo) -> [active (all delivered)]
[active]   -> (Driver takes Finish Odometer Photo + km) -> [completed]
```

1. **Phase 1: Start Route (`status: 'assigned'`)**:
   - UI shows button: `"Iniciar rota (Registrar Odômetro)"`.
   - Driver inputs odometer km and takes vehicle dashboard photo.
   - Sends to `POST /api/routes/:id/start`.
   - Server updates `routes.status = 'active'`, `routes.started_at = now()`, inserts into `odometer_readings(phase: 'start')`.
2. **Phase 2: Deliveries (`status: 'active'`)**:
   - Mini GPS Live Map displays current location and next pending stop.
   - Driver clicks `"Entrega feita"`.
   - Driver takes POD photo and adds optional notes.
   - Sends to `POST /api/routes/:id/deliveries/:stopId/complete`.
   - Server updates `route_stops.status = 'delivered'`, `delivered_at = now()`, inserts into `delivery_events`.
3. **Phase 3: Finish Route (`status: 'active'`)**:
   - Once all stops are delivered, UI prompts `"Finalizar rota (Registrar retorno)"`.
   - Driver inputs final odometer km and photo.
   - Sends to `POST /api/routes/:id/finish`.
   - Server updates `routes.status = 'completed'`, calculates `actual_km = final_km - start_km`, and updates `vehicles.current_odometer`.
   - Displays `"Ver Romaneio / Prestação de Contas"` to print or export the trip sheet.

### 4.5. Offline Storage & Synchronization Architecture
`lib/offline.ts` provides complete offline support:
- **IndexedDB**:
  - Database: `routewise-offline`, Version: `1`.
  - ObjectStore: `operations`, KeyPath: `id`.
  - Fallback: `memoryStore` (Map) if IndexedDB fails, is blocked in private browsing, or throws `QuotaExceededError`.
- **Idempotency Guarantee**:
  - Every operation generates a UUIDv4/UUIDv7 (`operationId` and `idempotencyKey`).
  - Passed in headers: `Idempotency-Key`, `X-Idempotency-Key`, `X-Operation-Id`.
  - Propagated into the JSON payload body.
  - Server routes use `ON CONFLICT (operation_id) DO NOTHING` or verify if the stop is already delivered, returning status 200/409 safely without duplicate events.
- **Client-Side Photo Compression (`lib/driver-photo.ts`)**:
  - Intercepts file capture before network transfer.
  - Compresses heavy images using `HTMLCanvasElement` or `OffscreenCanvas` to maximum dimensions `1600x1200px`, encoding as `image/webp` at `0.70` quality.
  - Guarantees images (>5MB) reduce to strictly `< 350KB` WebP, preventing IndexedDB quota overflow.
- **Synchronization (`flushQueue`)**:
  - Automatically triggered upon `window.ononline` or after manual action.
  - In-flight mutex (`isFlushing`) prevents race conditions and duplicate concurrent requests.
  - Drains items in FIFO order based on `createdAt`.
  - Handles 2xx and 409 by deleting items from queue.
  - Pauses cleanly on 401/403/5xx or network drops, retaining driver data safely until reconnection.

---

## 5. Route Creation & Dispatch: Required DB Mutations

To fulfill Requirements R1, R2, and R3 (Automated Routing Engine with Excel/CSV upload, clustering, and dispatch):

### 5.1. Target Dispatch DB Mutation Flow
When the manager clicks **"Save and Dispatch"** for generated routes:
1. **Target API Endpoint**: `POST /api/routes`
2. **Payload Structure**:
   ```json
   {
     "name": "Rota 01 - São Paulo (Zona Norte)",
     "routeDate": "2026-09-12",
     "optimizeBy": "distance",
     "circular": false,
     "driverId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
     "vehicleId": "7b12d591-6101-447b-a312-8d77bf1889a2",
     "estimatedKm": 48.5,
     "stops": [
       {
         "name": "Centro de Distribuição (Origem)",
         "address": "Rodovia Anhanguera, km 18, SP",
         "lat": -23.4812,
         "lng": -46.7419,
         "boxes": 0,
         "volume_m3": 0
       },
       {
         "name": "Supermercado Exemplo Ltda",
         "address": "Av. Tucuruvi, 1500, SP",
         "lat": -23.4791,
         "lng": -46.6023,
         "boxes": 14,
         "volume_m3": 2.45
       }
     ]
   }
   ```
3. **Database Transaction (`app/api/[...path]/route.ts` lines 581-617)**:
   - Starts SQL `BEGIN`.
   - Inserts row into `routes`:
     ```sql
     INSERT INTO routes(
       company_id, name, route_date, optimize_by, circular, estimated_km, driver_id, vehicle_id, status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *
     ```
     *Note*: If `driverId` and `vehicleId` are present, `status` is automatically set to `'assigned'`.
   - Sequentially loops through `stops` and inserts into `route_stops`:
     ```sql
     INSERT INTO route_stops(
       route_id, position, name, address, lat, lng, is_origin, boxes, volume_m3
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ```
     - Stop 0 has `position = 0` and `is_origin = true`.
     - Delivery stops 1..N have `position = 1..N`, `is_origin = false`, `status = 'pending'`.
   - Commits with `COMMIT`.

### 5.2. Immediate Visibility in Driver App
Because `status` is set to `'assigned'` and `driver_id` matches the assigned driver:
- The next time the driver visits the Driver Portal or calls `GET /api/routes`, the route matches `WHERE r.company_id = $1 AND r.driver_id = $2`.
- Since `r.route_date <= todayStr` and `r.status === 'assigned'`, it satisfies the `todayRoutes` filter.
- The route appears **immediately** on the driver's screen with the vehicle name, plate, and total deliveries count.

### 5.3. Loading Order (LIFO - Last In, First Out)
- Stop Sequence: Origin (0) -> Stop 1 -> Stop 2 -> ... -> Stop N.
- Delivery Order: Deliver Stop 1 first, Stop N last.
- **Physical Vehicle Loading (LIFO)**:
  - Stop N (last delivery) is loaded **first** into the front/deepest section of the cargo bay.
  - Stop 1 (first delivery) is loaded **last**, sitting directly at the rear doors for immediate unloading.
- The Dispatch UI must clearly display this reverse loading list (`Stops N down to 1`) for warehouse operators.

### 5.4. Recommended Schema Migration for Weight Support
To support weight limits specified in Requirement R1 and R2 (`Weight (kg)` and maximum vehicle weight capacity), a new migration `0006_routing_engine_capacities.sql` is recommended:
```sql
-- Migration 0006: Add weight and vehicle capacity support
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS weight_kg numeric(10,2) DEFAULT 0;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS client_order_id text;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS max_volume_m3 numeric(10,2) DEFAULT 30.0;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS max_weight_kg numeric(10,2) DEFAULT 3500.0;
```

---

## 6. Testing Infrastructure & Verification Setup

### Existing Test Suite Analysis
- **Test Runner**: Node.js built-in test runner via `node:test` and `node:assert/strict`.
- **Command**:
  ```bash
  npm test
  # runs: node --test tests/offline-photo-queue.test.mjs
  ```
- **Execution Test Results**:
  - Total Tests: **24 pass**, 0 fail, 0 skipped.
  - Test Duration: ~2.6 seconds.
  - Verification items:
    - R1 Client-Side WebP Compression (adaptive step-down, aspect ratio, max 1600x1200, < 350KB).
    - R2 Idempotent Offline Queue (UUID generation, IndexedDB put/getAll, memoryStore fallback, flushQueue mutex, network drop handling).
    - R3 UI Status Indicators contract checks.
- **TypeScript Typecheck**:
  ```bash
  npm run typecheck
  # runs: tsc --noEmit
  ```
  Exits cleanly with code 0 (no type errors).
- **Verification Script**:
  - `scripts/verify-all.mjs`: Tests HTTP endpoints (health, dispatcher auth, driver CRUD, vehicles, routes, uploads) against a running server on port 3000.

---

## 7. Recommendations for the Implementation Team

1. **Spreadsheet Upload & Parsing**:
   - Add a fast, reliable spreadsheet parsing utility. For CSV, standard delimiter parsing handles coordinates and commas in addresses. For `.xlsx`, consider `xlsx` (SheetJS) or a server-side route parser in `app/api/routing/parse/route.ts`.
2. **Clustering & Bin-Packing Algorithm (`lib/route-engine.ts`)**:
   - Structure the bin-packing engine with strict constraints:
     - Volume threshold: $\sum \text{volume\_m3} \le \text{vehicle.max\_volume\_m3}$ (e.g. 20m³ or 30m³).
     - Weight threshold: $\sum \text{weight\_kg} \le \text{vehicle.max\_weight\_kg}$.
     - Proximity clustering: K-Means or DBSCAN or geographic proximity heuristic based on postal code / city / coordinates.
3. **Database Insertion**:
   - Utilize existing `POST /api/routes` transactional insertion, or enhance it to accept batch route dispatches.
4. **UI Integration**:
   - Add a dedicated view or tab in the Manager UI (e.g., `Roteirizador Inteligente` / `/gestor/roteirizador` or inside the existing `planner` / `routes` views).
   - Match the dark blue dashboard palette (`--navy-900`, `--blue-600`, `--slate-800`).
5. **Testing**:
   - Implement unit tests for the routing engine in `tests/route-engine.test.mjs` using `node:test` to maintain zero-extra-tooling consistency.
