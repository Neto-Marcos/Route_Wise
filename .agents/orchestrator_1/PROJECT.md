# Project: Criar Rota TMS - Automated Routing Engine

## Architecture
- **Framework**: Next.js 15.5.3 (App Router), React 19.1.1, TypeScript, Node.js 24.
- **Database & Storage**: Dual PostgreSQL (pg.Pool) & embedded @electric-sql/pglite accessed via lib/db.ts. Plain SQL migrations in db/migrations/.
- **Parsing**: lib/spreadsheet-parser.ts supporting .xlsx (via xlsx package) and .csv (native RFC 4180 with delimiter detection, UTF-8/BOM cleaning, Brazilian decimal comma handling).
- **Geocoding**: lib/geo-brazil.ts in-memory lookup of Brazilian cities and logistics hubs for instant sub-5ms resolution and Haversine distance.
- **Routing Engine Core**: lib/route-engine.ts implementing spatial clustering, multi-dimensional bin-packing (volume m³ & weight kg), mathematical capacity invariant verification, TSP route sequencing (Nearest Neighbor + 2-Opt), and LIFO loading manifest generation.
- **Manager UI**:
  - Direct URL page: pp/gestor/roteirizador/page.tsx.
  - In-app Dispatcher tab: oteirizador in components/routewise-app.tsx and dedicated view components/automated-routing-view.tsx.
  - Design system: Strict dark-blue/dashboard color palette (--navy: #14243a, --card, --line, .panel, .button.primary, .metric, .status, .stop-loading-tag).
- **Dispatch API & Driver App Integration**:
  - POST /api/routes transactional insertion (outes and oute_stops).
  - Setting status = 'assigned' immediately surfaces the route in the Driver PWA under  Hoje tab.

## Code Layout
- db/migrations/0006_routing_engine_capacities.sql: Schema migration for weight_kg, order_id, products in oute_stops, and vehicle capacities.
- lib/geo-brazil.ts: In-memory Brazilian cities/hubs coordinates dictionary and Haversine distance calculator.
- lib/spreadsheet-parser.ts: Universal .xlsx and .csv parser with column normalization and Brazilian number sanitization.
- lib/route-engine.ts: Clustering, bin-packing, capacity guarantees, TSP sequencing, and LIFO manifest generation.
- components/automated-routing-view.tsx: Visual route suggestions, spreadsheet dropzone, capacity config, driver/vehicle selectors, LIFO instructions, and dispatch actions.
- pp/gestor/roteirizador/page.tsx: Direct URL route for the Automated Routing Engine.
- components/routewise-app.tsx: Dispatcher sidebar integration (oteirizador tab).
- pp/api/[...path]/route.ts: Support for route stops weight and cubage persistence.
- 	ests/route-engine.test.mjs: Core algorithm and parsing unit tests.
- 	ests/e2e-routing.test.mjs: Complete end-to-end integration and dispatch verification.

## Feature Inventory
Every feature from the Survey phase is enumerated here with its assigned milestone.
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Database Schema Migration | Add weight_kg, order_id, products to oute_stops and capacities to ehicles | M1 | Survey Explorer 1 |
| 2 | Universal Spreadsheet Parser | Ingest .xlsx and .csv, auto-detect delimiter, strip BOM, sanitize Brazilian decimals | M1 | Survey Spec Miner 3 |
| 3 | In-Memory Geo Dictionary | Brazilian cities and hubs coordinate mapping for sub-5ms SLA lookup | M1 | Survey Spec Miner 3 |
| 4 | Multi-Dimensional Bin-Packing | Partition orders into routes with strict volume (m³) and weight (kg) capacity guarantees | M2 | Survey Spec Miner 3 |
| 5 | Spatial Clustering & TSP | Cluster nearby cities and sequence stops via Nearest Neighbor + 2-Opt | M2 | Survey Spec Miner 3 |
| 6 | LIFO Loading Order Manifest | Reverse delivery order to generate warehouse loading guide (FUNDO to PORTA) | M2 | Survey Spec Miner 3 |
| 7 | Manager Roteirizador View | Visual suggested routes cards, metrics, dropzone, driver & vehicle selectors | M3 | Survey Explorer 2 |
| 8 | Navigation & Route Entry | Add /gestor/roteirizador route and sidebar tab in outewise-app.tsx | M3 | Survey Explorer 2 |
| 9 | Dispatch & DB Persistence | Transactional POST /api/routes saving Route & Stops with status 'assigned' | M3 | Survey Explorer 1 |
| 10 | Driver App Instant Availability | Dispatched routes appear immediately in Driver App Hoje tab | M3 | Survey Explorer 1 |
| 11 | Full E2E & Benchmark Validation | 100% test pass on parsing, clustering, capacity guarantees, and <3s benchmark | M4 (Final) | Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Schema Migration, In-Memory Geo & Spreadsheet Parser | db/migrations/0006..., lib/geo-brazil.ts, lib/spreadsheet-parser.ts, xlsx dependency | none | PLANNED |
| M2 | Route Engine Core: Clustering, Bin-Packing & LIFO | lib/route-engine.ts with mathematical capacity invariants and LIFO instructions | M1 | PLANNED |
| M3 | Manager UI, Direct Route & Driver Dispatch Integration | pp/gestor/roteirizador/page.tsx, components/automated-routing-view.tsx, components/routewise-app.tsx, pp/api/... | M1, M2 | PLANNED |
| M4 | E2E Testing Suite & Performance Hardening | Opaque-box test suite (Tiers 1-4) passing 100% and Tier 5 adversarial verification | M1, M2, M3 | PLANNED |

## Interface Contracts
### lib/spreadsheet-parser.ts -> lib/route-engine.ts
`	ypescript
export interface ParsedOrder {
  orderId: string;
  clientName: string;
  address: string;
  city: string;
  uf?: string;
  volumeM3: number;
  weightKg: number;
  boxes: number;
  products?: string;
  lat?: number;
  lng?: number;
}
export function parseSpreadsheet(buffer: Buffer, fileName: string): Promise<ParsedOrder[]>;
`

### lib/route-engine.ts -> components/automated-routing-view.tsx
`	ypescript
export interface RoutingEngineOptions {
  maxVolumeM3: number;   // e.g. 20.0 or 30.0
  maxWeightKg: number;   // e.g. 3500.0 or 6000.0
  originDepot: { name: string; address: string; lat: number; lng: number };
}
export interface SuggestedRoute {
  id: string;
  name: string;
  totalVolumeM3: number;
  totalWeightKg: number;
  totalBoxes: number;
  estimatedKm: number;
  stops: Array<{
    position: number;
    name: string;
    address: string;
    city: string;
    lat: number;
    lng: number;
    boxes: number;
    volume_m3: number;
    weight_kg: number;
    orderId?: string;
    products?: string;
    is_origin: boolean;
  }>;
  lifoManifest: Array<{
    loadingStep: number;
    compartmentPosition: FUNDO | MEIO | PORTA;
    deliveryOrderIndex: number;
    stopName: string;
    address: string;
    orderId?: string;
    boxes: number;
    volumeM3: number;
    weightKg: number;
  }>;
}
export function generateOptimizedRoutes(orders: ParsedOrder[], options: RoutingEngineOptions): SuggestedRoute[];
`

### components/automated-routing-view.tsx -> POST /api/routes
`	ypescript
// Body matches existing /api/routes schema with driverId, vehicleId, routeDate, stops.
// Server sets status = 'assigned' when driverId and vehicleId are provided.
`
