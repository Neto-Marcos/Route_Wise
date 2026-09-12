# Survey Report: Manager UI Architecture, Navigation, and Design System
**Criar Rota TMS — Automated Routing Engine Integration**
**Date**: 2026-09-12
**Author**: Explorer 2 (Manager UI Architecture Specialist)

---

## Executive Summary

This survey provides a comprehensive architectural assessment of the Manager UI ("Central de Operações") in Criar Rota TMS, focusing on how the new **Automated Routing Engine** (`/gestor/roteirizador`) should be integrated into the navigation, layout, design system, and database workflows.

### Core Discoveries
1. **Routing Architecture**: Next.js 15.5.3 App Router (`/app`). The application currently operates as a client-side SPA state machine mounted at `app/page.tsx` via `RouteWiseApp`. No `/gestor` routes exist yet; direct URL `/gestor/roteirizador` requires creating `app/gestor/roteirizador/page.tsx`, and in-app navigation requires adding a new tab `"roteirizador"` to the Manager sidebar.
2. **Design System Reality**: Despite prompt references to "Tailwind-based UI", the project **does not have Tailwind CSS installed** in `package.json` nor configured in a config file. Instead, the entire design system is powered by a mature, 4,648-line semantic CSS architecture in `app/globals.css` with CSS custom properties (`--navy`, `--blue`, `--paper`, `--card`, `--line`, etc.), dark mode classes, and standardized component styles (`.panel`, `.button`, `.modal`, `.metrics`, `.status`, `.stop-loading-tag`, `.route-summary-cubagem-bar`).
3. **Existing LIFO and Cubage Assets**: The codebase already has database columns and CSS styling for stop volume (`route_stops.volume_m3`), item count (`route_stops.boxes`), and LIFO loading order badges (`.stop-loading-tag`: `📦 Nº a carregar (porta/fundo)`).
4. **Driver & Vehicle APIs**: `GET /api/drivers?all=true` and `GET /api/vehicles` provide registered active assets. The existing assignment flow in `POST /api/routes` sets `status = 'assigned'` whenever `driverId` and `vehicleId` are provided, making routes immediately visible in the driver PWA.
5. **Database ORM Clarification**: The request mentioned "DB insertions using Drizzle ORM", but the project actually uses raw SQL via `@electric-sql/pglite` / `pg` with migrations in `db/migrations/` and client helpers in `lib/db.ts`.

---

## 1. Next.js Routing and Page Layout Structure

### 1.1 Next.js Version and Directory Layout
- **Next.js Version**: `15.5.3` with React `19.1.1` (`package.json`).
- **App Directory**: App Router (`/app`), using TypeScript (`.tsx`, `.ts`).
- **Existing App Files**:
  ```
  app/
  ├── layout.tsx             # Root layout with metadata, viewport (#14243A), Leaflet & globals.css
  ├── globals.css            # Global CSS custom properties and component rules
  ├── page.tsx               # Root entry page: exports default Page() => <RouteWiseApp />
  ├── offline/
  │   └── page.tsx           # Static fallback page for offline PWA navigation
  └── api/
      ├── [...path]/route.ts # Catch-all dynamic REST API handler (drivers, vehicles, routes, auth, etc.)
      └── routes/route.ts    # Alias forwarding GET/POST to [...path]/route.ts
  ```

### 1.2 Layout Hierarchy and Boundaries
- `app/layout.tsx`:
  - Enforces `<html lang="pt-BR"><body>{children}</body></html>`.
  - Sets viewport theme color to `#14243A` (`--navy`).
  - Loads Leaflet CSS (`leaflet/dist/leaflet.css`) globally.
  - Loads `globals.css` globally.
- `app/page.tsx`:
  - Marked with `"use client"` inside `components/routewise-app.tsx`.
  - Controls top-level portal state:
    - `"home"`: Public landing screen with role selection ("Sou gestor" / "Sou motorista").
    - `"planner"`: Standalone manual map route planner view.
    - `"dispatcher"`: Manager workspace. If unauthenticated, displays PIN/login modal; if authenticated, renders `<Dispatcher onExit={...} />`.
    - `"driver"`: Driver app portal. If unauthenticated, renders `<DriverPicker />`; if authenticated, renders `<DriverApp />`.

---

## 2. Existing Manager UI Architecture

### 2.1 Navigation & Workspace Layout
The Manager UI is encapsulated in `function Dispatcher({ onExit })` in `components/routewise-app.tsx` (lines 1092–1293).

```tsx
<div className={`workspace managed-workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${tab === "planner" ? "planning-workspace" : ""}`}>
  <aside className="sidebar">
    {/* Collapse toggle button */}
    <nav>
      {/* Sidebar navigation items */}
    </nav>
    <div className="sidebar-footer-actions">
      {/* Exit button */}
    </div>
  </aside>
  <main className="dashboard">
    <header>
      <span className="eyebrow">CENTRAL DE OPERAÇÕES</span>
      <h1>{/* Dynamic tab title */}</h1>
      <span className="live"><i /> Atualização automática</span>
    </header>
    {/* Dynamic tab content panel */}
  </main>
</div>
```

### 2.2 Sidebar Structure and States
- **Grid Layout**:
  - Expanded: `238px 1fr`
  - Collapsed: `70px 1fr` (toggled via `.sidebar-collapse`, state stored in `localStorage.rw_sidebar_collapsed`).
  - Mobile (width $\le$ 700px): Fixed bottom bar at `bottom: 0`, `height: 64px`, with 4-column icon navigation.
- **Existing Tabs**:
  | Tab ID | Nav Label | Lucide Icon | Panel Rendered | Description |
  |---|---|---|---|---|
  | `overview` | Visão geral | `<RouteIcon />` | `<Overview />` | Metrics, live fleet map, route table |
  | `planner` | Planejar rota | `<Navigation />` | `<RoutePlannerView />` | Manual map route planner (OSRM/Nominatim) |
  | `routes` | Rotas | `<Navigation />` | `<RoutesPanel />` | Route history, filtering, assignment, detail/print modals |
  | `people` | Motoristas | `<Users />` | `<Registry kind="driver" />` | Driver CRUD, photo, PIN, status toggle |
  | `vehicles` | Veículos | `<Truck />` | `<Registry kind="vehicle" />` | Fleet CRUD, plate, odometer, status toggle |
  | `dispatchers` | Gestores | `<ShieldCheck />` | `<DispatchersPanel />` | Manager user management & company invite code |

### 2.3 Live Data Polling
- In `Dispatcher`:
  ```typescript
  const load = useCallback(() =>
    Promise.all([
      api("/api/routes"),
      api("/api/drivers?all=true"),
      api("/api/vehicles"),
      api("/api/dispatchers").catch(() => []),
      api("/api/session/me").catch(() => null),
    ]).then(([r, d, v, disp, sess]) => {
      setRoutes(r);
      setDrivers(d);
      setVehicles(v);
      if (Array.isArray(disp)) setDispatchers(disp);
      if (sess) setSessionInfo(sess);
    }),
    [onExit]
  );

  useEffect(() => {
    load();
    const id = setInterval(load, 10000); // 10s auto-refresh
    return () => clearInterval(id);
  }, [load]);
  ```

---

## 3. Design System & CSS Architecture

### 3.1 Framework Assessment
- **Status**: The codebase uses **native semantic CSS** with CSS Custom Properties and utility/component classes defined in `app/globals.css`.
- There is **no `tailwind.config.js`** and no `@tailwind` processor configured in `package.json`.
- All visual components strictly adhere to standard design tokens defined at the root.

### 3.2 Exact Color Palette & Design Tokens

| Token | Light Theme Value | Dark Theme Value (`.dark`, `[data-theme="dark"]`) | Purpose / Usage |
|---|---|---|---|
| `--navy` | `#14243a` | `#0d1726` | Sidebar background, driver header, home hero gradient |
| `--blue` | `#059669` | `#10b981` | Brand accent / primary emerald color for primary buttons, active links, checkmarks |
| `--blue-hover` | `#047857` | `#34d399` | Primary button hover state |
| `--paper` | `#f8fafc` | `#0a111c` | Workspace background, general page canvas |
| `--card` | `#ffffff` | `#131d2e` | Panel cards, modal bodies, table rows, form controls |
| `--card-subtle` | `#f1f5f9` | `#19263c` | Sub-panels, secondary containers, input borders |
| `--card-hover` | `#f8fafc` | `#1f304c` | Hover state on list cards |
| `--muted` | `#64748b` | `#94a3b8` | Subtitles, helper text, empty states, address text |
| `--line` | `#e2e8f0` | `#20304a` | Standard container borders, dividers, inputs |
| `--green` | `#059669` | `#10b981` | Success states, active dots, positive metrics |
| `--red` | `#dc2626` | `#ef4444` | Danger actions, errors, cancelled status |
| `--amber` | `#d97706` | `#f59e0b` | Assigned status, warnings, LIFO tags |
| `--shadow` | `0 10px 30px rgba(0,0,0,0.07)` | `0 14px 40px rgba(0,0,0,0.5)` | Modal and card drop shadow |

#### Specific Sidebar Colors
- Background: `var(--navy)` (`#14243a`)
- Inactive Nav Button: Text `#8795ad`, Background `transparent`
- Active Nav Button: Text `#ffffff`, Background `#1d2c48`
- Collapse Button: Border `#334155`, Text `#cbd5e1`

#### Route Color Palette (`STOP_PALETTE` in `routewise-app.tsx`)
```typescript
export const STOP_PALETTE = [
  "#0f172a", // Origin / Depósito (CD - Deep Navy/Black)
  "#3b82f6", // Stop 1 - Royal Blue
  "#10b981", // Stop 2 - Emerald Green
  "#8b5cf6", // Stop 3 - Purple
  "#f97316", // Stop 4 - Orange
  "#f43f5e", // Stop 5 - Red
  "#06b6d4", // Stop 6 - Cyan
  "#eab308", // Stop 7 - Amber
  "#6366f1", // Stop 8 - Indigo
  "#14b8a6", // Stop 9 - Teal
];
```

### 3.3 Core UI Component Library & CSS Specifications

#### 1. Buttons (`.button`, `.btn-link`)
- **Primary**:
  ```css
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 16px;
    border: 0;
    border-radius: 11px;
    text-decoration: none;
    font-weight: 780;
    cursor: pointer;
  }
  .button.primary { background: var(--blue); color: white; }
  .button.primary:hover { background: var(--blue-hover); }
  .button.secondary { background: #e9eef7; color: #354054; }
  .button.compact { min-height: 38px; font-size: 13px; }
  .button:disabled { opacity: 0.55; cursor: not-allowed; }
  ```

#### 2. Modals (`.modal-backdrop`, `.modal`)
- Defined in lines 731–760 and 4381–4405:
  ```css
  .modal-backdrop {
    position: fixed;
    z-index: 1000;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 18px;
    background: #080e1a8c;
    backdrop-filter: blur(5px);
  }
  .modal {
    width: min(100%, 470px);
    max-height: 92dvh;
    overflow: auto;
    border-radius: 19px;
    background: var(--card);
    box-shadow: var(--shadow);
  }
  .modal.wide { width: min(100%, 700px); }
  .modal > header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px;
    border-bottom: 1px solid var(--line);
    background: var(--card);
  }
  ```

#### 3. Panels & Cards (`.panel`, `.card`)
```css
.panel {
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 17px;
  background: var(--card);
}
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
}
.panel-title h2 { margin: 0; font-size: 18px; }
.panel-title p { margin: 4px 0; color: var(--muted); font-size: 13px; }
```

#### 4. Metrics Dashboard Row (`.metrics`, `.metric`)
```css
.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}
.metric {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 15px;
  background: var(--card);
}
.metric > span {
  display: grid;
  place-items: center;
  width: 43px;
  height: 43px;
  border-radius: 12px;
  background: #edf2ff;
  color: var(--blue);
}
.metric strong { font-size: 25px; }
```

#### 5. Form Inputs & Grids (`.form-grid`, `.form-row`)
```css
.form-grid { display: grid; gap: 14px; padding: 20px; }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
.form-grid label, .form-row label { display: grid; gap: 6px; font-size: 13px; font-weight: 750; }
.form-grid input, .form-grid select, .form-row input, .form-row select {
  width: 100%;
  min-height: 43px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  color: var(--ink);
  outline: none;
}
input:focus, select:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px #2f6df61f;
}
```

#### 6. File Dropzone & Upload Style
- Existing photo input style (`.photo-input`):
  ```css
  .photo-input {
    display: flex;
    min-height: 94px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    border: 1px dashed #afbee2;
    border-radius: 12px;
    background: #f7f9ff;
    color: #526282;
  }
  ```
- Recommended spreadsheet dropzone pattern (`.spreadsheet-dropzone`):
  ```css
  .spreadsheet-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 20px;
    border: 2px dashed var(--line);
    border-radius: 16px;
    background: var(--card-subtle);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .spreadsheet-dropzone.drag-active {
    border-color: var(--blue);
    background: rgba(5, 150, 105, 0.06);
  }
  ```

#### 7. Badges & Loading Order Tags
- Status badge (`.status`):
  ```css
  .status {
    padding: 5px 8px;
    border-radius: 99px;
    font-size: 11px;
    font-weight: 800;
  }
  .status.draft { background: #eef1f5; color: #596273; }
  .status.assigned { background: #fff3d8; color: #925f00; }
  .status.active { background: #e1f8ef; color: #087a55; }
  .status.completed { background: #e9efff; color: #3155b5; }
  .status.cancelled { background: #fff0f1; color: #b32432; }
  ```
- **LIFO Loading Order Tag** (`.stop-loading-tag`):
  ```css
  .stop-loading-tag {
    display: inline-block;
    margin-top: 2px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.35);
    color: #b45309;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  [data-theme="dark"] .stop-loading-tag {
    color: #fbbf24;
    background: rgba(245, 158, 11, 0.18);
    border-color: rgba(245, 158, 11, 0.4);
  }
  ```
- **Cubage Summary Bar** (`.route-summary-cubagem-bar`):
  ```css
  .route-summary-cubagem-bar {
    display: flex;
    align-items: center;
    justify-content: space-around;
    padding: 4px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.18);
    font-size: 10.5px;
    color: #ffffff;
    margin-top: 2px;
  }
  ```

---

## 4. Manager Interaction with Drivers & Vehicles

### 4.1 Database Model & Columns
- `drivers`:
  - `id` (UUID PRIMARY KEY)
  - `company_id` (UUID NOT NULL REFERENCES companies)
  - `name` (text NOT NULL)
  - `phone` (text)
  - `photo` (text)
  - `active` (boolean NOT NULL DEFAULT true)
- `vehicles`:
  - `id` (UUID PRIMARY KEY)
  - `company_id` (UUID NOT NULL REFERENCES companies)
  - `name` (text NOT NULL)
  - `plate` (text NOT NULL)
  - `current_odometer` (numeric(12,1) NOT NULL DEFAULT 0)
  - `rate_per_km` (numeric(12,2))
  - `active` (boolean NOT NULL DEFAULT true)
  - *Note*: Standard volume capacity (e.g. 20m³ / 30m³) is not currently a column in `vehicles`; it is configured dynamically in the routing engine or can default to company parameters.
- `routes`:
  - `id` (UUID), `company_id` (UUID), `name` (text), `route_date` (date), `status` ('draft', 'assigned', 'active', 'completed', 'cancelled'), `driver_id` (UUID), `vehicle_id` (UUID), `estimated_km` (numeric).
- `route_stops`:
  - `id` (UUID), `route_id` (UUID), `position` (int), `name` (text), `address` (text), `lat` (double precision), `lng` (double precision), `is_origin` (boolean), `status` ('pending', 'delivered'), `boxes` (int), `volume_m3` (numeric(10,2)).

### 4.2 APIs & Query Contracts
1. **List Drivers**:
   - `GET /api/drivers?all=true`
   - Returns: `Driver[]` with all registered drivers for the authenticated company.
   - Filter active drivers in UI: `drivers.filter((d) => d.active !== false)`.
2. **List Vehicles**:
   - `GET /api/vehicles`
   - Returns: `Vehicle[]` with all registered fleet vehicles for the company.
   - Filter active vehicles in UI: `vehicles.filter((v) => v.active !== false)`.
3. **Dispatch & Assignment Contract**:
   - Creating an assigned route in one step:
     ```typescript
     POST /api/routes
     Body: {
       name: "Rota 1 - Curitiba Sul (Capacidade 20m³)",
       routeDate: "2026-09-13",
       driverId: "<driver-uuid>",
       vehicleId: "<vehicle-uuid>",
       optimizeBy: "distance",
       circular: false,
       estimatedKm: 42.5,
       stops: [
         { position: 0, name: "CD Principal", address: "Rua Depósito, 100", lat: -25.42, lng: -49.27, is_origin: true, boxes: 0, volume_m3: 0 },
         { position: 1, name: "Supermercado Exemplo", address: "Av. Brasil, 450", lat: -25.44, lng: -49.28, is_origin: false, boxes: 12, volume_m3: 4.5 },
         // ...
       ]
     }
     ```
   - When both `driverId` and `vehicleId` are supplied, the backend automatically assigns `status = 'assigned'`.
   - Result: Immediately visible in the assigned driver's offline PWA under `todayRoutes`!

### 4.3 Select Dropdown Interaction Pattern
The existing standard for driver/vehicle selection (from `Assign` component in `routewise-app.tsx`):
```tsx
<label>
  Motorista
  <select name="driver" value={selectedDriverId} onChange={e => setSelectedDriverId(e.target.value)} required>
    <option value="">Selecione o motorista</option>
    {drivers.filter(d => d.active !== false).map(d => (
      <option key={d.id} value={d.id}>{d.name}</option>
    ))}
  </select>
</label>

<label>
  Veículo da Frota
  <select name="vehicle" value={selectedVehicleId} onChange={e => setSelectedVehicleId(e.target.value)} required>
    <option value="">Selecione o veículo</option>
    {vehicles.filter(v => v.active !== false).map(v => (
      <option key={v.id} value={v.id}>{v.name} · {v.plate}</option>
    ))}
  </select>
</label>
```

---

## 5. Location and Integration of `/gestor/roteirizador`

### 5.1 Proposed File Layout
To fulfill both direct URL navigation (`/gestor/roteirizador`) and cohesive in-app Manager SPA behavior:

```
app/
├── gestor/
│   ├── page.tsx                    # Optional shortcut redirecting to Manager workspace
│   └── roteirizador/
│       └── page.tsx                # Standalone URL route for Automated Routing Engine
components/
├── routewise-app.tsx               # Manager SPA containing Dispatcher tabs
├── automated-routing-view.tsx      # Main Roteirizador View (Dropzone, Parsed List, Route Cards, Assignment)
lib/
├── route-engine.ts                 # Clustering & Bin-Packing Algorithm (R2)
└── spreadsheet-parser.ts           # Excel/CSV parser (R1)
```

### 5.2 Navigation Sidebar Integration
Inside `components/routewise-app.tsx` in `Dispatcher({ onExit })`:
1. Expand the tab union:
   ```typescript
   const [tab, setTab] = useState<
     "overview" | "roteirizador" | "planner" | "routes" | "people" | "vehicles" | "dispatchers"
   >("overview");
   ```
2. Add the navigation button:
   ```tsx
   {[
     ["overview", "Visão geral", <RouteIcon key="o" />],
     ["roteirizador", "Roteirizador Automático", <Sparkles key="rot" />], // New Tab!
     ["planner", "Planejar rota manual", <Navigation key="n" />],
     ["routes", "Rotas", <Navigation key="r" />],
     ["people", "Motoristas", <Users key="p" />],
     ["vehicles", "Veículos", <Truck key="v" />],
     ["dispatchers", "Gestores", <ShieldCheck key="g" />],
   ].map(([id, label, icon]) => ( ... ))}
   ```
3. In the header:
   ```tsx
   <h1>
     {tab === "overview"
       ? "Visão geral"
       : tab === "roteirizador"
         ? "Roteirizador Automático de Entregas"
         : tab === "planner"
           ? "Planejador de rotas"
           : /* ... */}
   </h1>
   ```
4. Render the panel:
   ```tsx
   {tab === "roteirizador" && (
     <AutomatedRoutingView
       drivers={drivers}
       vehicles={vehicles}
       onRouteDispatched={load}
     />
   )}
   ```

### 5.3 Direct URL Route (`app/gestor/roteirizador/page.tsx`)
```tsx
"use client";
import RouteWiseApp from "@/components/routewise-app";

export default function GestorRoteirizadorPage() {
  // Mounts the app with initial portal = 'dispatcher' and initial tab = 'roteirizador'
  return <RouteWiseApp defaultPortal="dispatcher" defaultTab="roteirizador" />;
}
```

---

## 6. End-to-End User Flow for `/gestor/roteirizador`

```
┌─────────────────────────────────────────────────────────────┐
│ 1. UPLOAD & CONFIGURATION                                   │
│  - Drag & drop .xlsx or .csv                                │
│  - Set Vehicle Volume Capacity (e.g. 20m³ / 30m³)           │
│  - Set Origin / CD (Depósito Central)                       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. PARSE SPREADSHEET (Client or Server API)                 │
│  - Parse Client, City/Address, Order ID, Volume m³, Weight  │
│  - Display parsed preview table & data validation metrics   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CLUSTERING & BIN-PACKING ALGORITHM (lib/route-engine.ts) │
│  - Cluster stops by geographic proximity (City / LatLng)    │
│  - Partition clusters into Routes <= Vehicle Capacity m³    │
│  - Order deliveries in logical sequence (TSP / nearest)     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. VISUAL REVIEW OF SUGGESTED ROUTES                        │
│  - Route cards with total m³ (and % utilized), total kg     │
│  - LIFO Loading Order Badge (Última entrega carrega 1º)     │
│  - Stop sequence preview (CD -> Parada 1 -> Parada 2...)    │
│  - Driver dropdown + Vehicle dropdown selection per route   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. SAVE AND DISPATCH                                        │
│  - Batch creates Routes & Stops via POST /api/routes        │
│  - Sets status = 'assigned'                                 │
│  - Real-time success banner + direct link to Driver PWA     │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Key Findings & Recommendations for Implementers

1. **Do Not Introduce Tailwind Config Incompatibilities**:
   - Since the app is built without Tailwind and relies on `app/globals.css`, implement the new view using the established CSS classes (`.panel`, `.button`, `.form-grid`, `.metric`, etc.) or add a modular component CSS file (e.g. `app/roteirizador.css` or styled classes in `globals.css`).
2. **Spreadsheet Parsing Dependencies**:
   - `package.json` does not have `xlsx` or `papaparse`.
   - CSV parsing can be implemented zero-dependency in TypeScript.
   - For `.xlsx` support, install `xlsx` (SheetJS) or handle both format parsers cleanly.
3. **LIFO Loading Order Presentation**:
   - Strictly follow the established convention:
     - Stop 0 = Origin (CD / Garagem)
     - Delivery stops $1 \dots N$.
     - Delivery sequence = $1 \to N$
     - Loading sequence (LIFO) = $N \to 1$ (Stop $N$ is 1º a carregar no fundo do baú; Stop 1 is $N$º a carregar, junto à porta para descarregar primeiro).
4. **Database ORM Clarification**:
   - The user prompt mentions "DB insertions using Drizzle ORM", but the existing repository uses raw SQL transactions via `lib/db.ts` (`BEGIN ... INSERT INTO routes ... INSERT INTO route_stops ... COMMIT`).
   - If Drizzle is introduced, it must be installed; alternatively, the existing transactional SQL engine in `app/api/[...path]/route.ts` already perfectly handles creating routes with stops, cubage, and vehicle assignments.

---
*Report completed by Explorer 2.*
