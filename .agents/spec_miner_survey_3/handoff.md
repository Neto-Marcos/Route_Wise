# Handoff Report — Spec Miner 3: Routing Engine Core, Spreadsheet Parsing & Algorithmic Requirements

## 1. Observation
1. **Spreadsheet Dependencies in `package.json`**:
   - Inspected `package.json`: Dependencies are `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@electric-sql/pglite`, `bcryptjs`, `jose`, `leaflet`, `lucide-react`, `next`, `pg`, `react`, `react-dom`, `sharp`, `zod`.
   - `xlsx`, `exceljs`, `papaparse`, `csv-parse` are **not installed** in `package.json` or `pnpm-lock.yaml`.
   - Verified via `npm view xlsx version` (`0.18.5`) and `npm view papaparse version` (`5.7.0`) that standard packages are available on npm. Node version is `v24.16.0`, npm is `11.15.0`, and `npx pnpm --version` is `10.15.1`.
2. **Absence of Sample Spreadsheets**:
   - `find_by_name` for extensions `csv`, `xlsx`, `xls` returned `0` files. There are currently no mock or sample spreadsheet files in the repository.
3. **Database Layer & Schema Reality**:
   - Inspected `lib/db.ts` lines 8-54 and `db/migrations/0001_initial.sql` to `0005_route_load_fields.sql`.
   - The database layer uses `pg.Pool` or `@electric-sql/pglite` with raw SQL query strings and auto-migrations.
   - Despite `ORIGINAL_REQUEST.md` mentioning "using Drizzle ORM", `grep_search` for `drizzle` returned 0 occurrences across the codebase.
   - `route_stops` currently has columns: `id`, `route_id`, `position`, `name`, `address`, `lat`, `lng`, `is_origin`, `status`, `delivered_at`, `boxes` (integer), `volume_m3` (numeric(10,2)). Columns for `weight_kg`, `order_id`, and `products` are not yet in `route_stops`.
   - `app/api/[...path]/route.ts` line 319 executes `SELECT * FROM route_stops WHERE route_id=$1 ORDER BY position`, meaning newly added columns are automatically forwarded to API responses.
4. **Geocoding & OSRM Latency Constraints**:
   - `app/api/[...path]/route.ts` lines 108-138 implements Nominatim queries with a mandatory rate-limiting sleep:
     ```ts
     if (kind === "restaurant") await new Promise((resolveDelay) => setTimeout(resolveDelay, 1050));
     ```
   - Making 50 individual HTTP geocoding calls during spreadsheet parsing would take $\ge 52.5$ seconds, violating the $< 3$ seconds acceptance criterion.
   - `components/routewise-app.tsx` line 4371 and `components/driver-live-map.tsx` line 140 already have the Haversine distance formula implemented.
5. **Existing LIFO Loading Order Logic**:
   - Inspected `components/routewise-app.tsx` lines 3042-3097:
     ```tsx
     {stops.filter((_, idx) => idx > 0).reverse().map((stop, idx, arr) => {
       const originalIndex = stops.length - 1 - idx;
       const isFirstLoaded = idx === 0;
       const isLastLoaded = idx === arr.length - 1;
       ...
     ```
     The physical truck compartment loading guide is already established: the last delivery is loaded first (`#1 - FUNDO`), and the first delivery is loaded last (`#N - PORTA`).

## 2. Logic Chain
1. *From Observation 1 & 2*: Since no spreadsheet parser is installed and no sample spreadsheet exists in the repo, the routing engine must provide both: (a) a specification for canonical column mappings (including Brazilian TMS synonyms like `Cliente`, `Destinatário`, `Cidade`, `Endereço`, `Pedido`, `NF`, `Cubagem m3`, `Peso kg`, `Volumes`) and (b) dependency requirements (`xlsx` or pure TypeScript RFC 4180 CSV parser).
2. *From Observation 4*: Because external geocoding via Nominatim enforces 1 req/sec and external network latency would exceed the 3-second SLA for batches of 20-100 orders, geocoding must be resolved via an in-memory dictionary of Brazilian hub cities (`lib/geo-brazil.ts`) in $O(1)$ (< 5ms total), with coordinates either read from the spreadsheet or mapped from cities/CEPs.
3. *From Observation 3*: To persist weight, order ID, and products from the spreadsheet to the driver app without schema breakage, migration `0006` should add `weight_kg numeric(10,2)`, `order_id text`, and `products text` to `route_stops`. Because the existing queries use `SELECT *`, all downstream driver views and report modals will seamlessly receive these fields.
4. *From Observation 5*: To ensure consistency between route generation and driver/warehouse operations, the algorithmic routing engine must output the LIFO loading order matching the existing inversion formula (`.filter(pos > 0).reverse()`), designating index 0 as `FUNDO` (bulkhead) and index $N-1$ as `PORTA` (rear door).
5. *From Requirement R2 & Acceptance Criteria*: Mathematical guarantees that no route exceeds `MAX_VOLUME` (20 or 30 $m^3$) or `MAX_WEIGHT` require a multi-constraint bin-packing algorithm (Cluster-First, Route-Second) accompanied by a runtime assertion validator `assertCapacityInvariants()` that guarantees post-conditions before suggestions are rendered.

## 3. Caveats
1. While `ORIGINAL_REQUEST.md` mentions "using Drizzle ORM", the entire codebase uses native PostgreSQL/PGlite queries (`lib/db.ts`). Introducing Drizzle ORM is not strictly required unless the orchestrator explicitly requests a Drizzle migration; transactional raw SQL via `db.connect()` is the existing production pattern.
2. When addresses in a spreadsheet cannot be matched to known Brazilian cities or lack lat/lng, a graceful fallback to the dispatch warehouse origin coordinates (marked as "Coordenada aproximada") is necessary to prevent pipeline crashes.

## 4. Conclusion
The specification for the Routing Engine Core has been thoroughly mined, formulated, and documented in:
`C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\spec_miner_survey_3\spec_routing_engine.md`
It delivers:
- Universal spreadsheet ingestion specification for `.xlsx` and `.csv` with Brazilian column synonym dictionary and decimal sanitization.
- Sub-second in-memory geographic clustering and proximity logic using embedded Brazilian logistics hubs and Haversine distance.
- 2-Dimensional Bin-Packing (Volume $m^3$ + Weight $kg$) with route-splitting and mathematical invariant guarantees.
- LIFO loading order manifest aligned with existing warehouse expedição UI.
- Detailed performance budget achieving ~175 ms total execution time (well within the 3-second SLA).
- Full tables of 11 Discovered Features and 12 Edge Cases.

## 5. Verification Method
1. **File Inspection**:
   Inspect `spec_routing_engine.md` to verify the presence of:
   - Section 2: Spreadsheet Ingestion & Column Synonym Dictionary.
   - Section 3: In-Memory Brazilian Geocoding Hubs & Haversine formula.
   - Section 4: 4-Phase Clustering, Bin-Packing & Mathematical Invariants.
   - Section 5: LIFO Loading Sequence & Reverse Mapping Formula.
   - Section 7: Performance Budget Breakdown (< 3s SLA).
   - Section 8: Features Discovered Table (11 features).
   - Section 9: Edge Cases Table (12 edge cases).
2. **Codebase Verification Commands**:
   - Verify Node and pnpm availability:
     `npx pnpm --version` (returns `10.15.1`)
   - Verify absence of spreadsheet libraries in `package.json`:
     `node -e "const pkg=require('./package.json'); console.log(pkg.dependencies.xlsx, pkg.dependencies.papaparse)"` (returns `undefined undefined`)
   - Verify existing tests continue to pass:
     `node --test tests/offline-photo-queue.test.mjs`
