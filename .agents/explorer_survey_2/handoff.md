# Handoff Report: Explorer 2 (Manager UI Architecture & Design System)

**Date**: 2026-09-12
**Status**: Hard Handoff (Investigation Complete)
**Working Directory**: `C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\explorer_survey_2`
**Target Output**: `survey_manager_ui.md`

---

## 1. Observation

1. **Next.js & Routing Layout**:
   - `package.json` specifies `"next": "^15.5.3"`, `"react": "^19.1.1"`, `"lucide-react": "^0.544.0"`.
   - `app/layout.tsx` (lines 1-54) imports `"leaflet/dist/leaflet.css"` and `"./globals.css"`, defining `themeColor: "#14243A"`.
   - `app/page.tsx` (lines 1-3) exports `default function Page() { return <RouteWiseApp/> }`.
   - The application currently has only two `page.tsx` files: `app/page.tsx` and `app/offline/page.tsx`. There is no `/gestor` directory or `app/gestor/roteirizador/page.tsx`.

2. **Manager UI & Navigation**:
   - `components/routewise-app.tsx` (lines 1092–1293) implements `function Dispatcher({ onExit })`.
   - Line 1097 defines the active tabs:
     ```typescript
     const [tab, setTab] = useState<"overview" | "planner" | "routes" | "people" | "vehicles" | "dispatchers">("overview");
     ```
   - Lines 1172–1190 define the sidebar navigation buttons:
     - `overview` ("Visão geral", `<RouteIcon />`)
     - `planner` ("Planejar rota", `<Navigation />`)
     - `routes` ("Rotas", `<Navigation />`)
     - `people` ("Motoristas", `<Users />`)
     - `vehicles` ("Veículos", `<Truck />`)
     - `dispatchers` ("Gestores", `<ShieldCheck />`)
   - Lines 1114–1145 load data via `Promise.all([api("/api/routes"), api("/api/drivers?all=true"), api("/api/vehicles"), api("/api/dispatchers"), api("/api/session/me")])` with a 10-second polling interval (`setInterval(load, 10000)`).

3. **Design System & Tailwind Reality**:
   - Ripgrep for `tailwind` across the repository returned 0 matches (`find_by_name` for `*tailwind*` and `*postcss*` returned 0 results). There is NO `tailwind.config.js` and no Tailwind package in `package.json`.
   - `app/globals.css` (lines 1–38) defines custom CSS properties for both light and dark themes:
     - `--navy: #14243a` (light), `#0d1726` (dark)
     - `--blue: #059669` (light), `#10b981` (dark)
     - `--paper: #f8fafc` (light), `#0a111c` (dark)
     - `--card: #ffffff` (light), `#131d2e` (dark)
     - `--line: #e2e8f0` (light), `#20304a` (dark)
     - `--muted: #64748b` (light), `#94a3b8` (dark)
   - Component styles in `app/globals.css`:
     - `.button.primary` (lines 354–357)
     - `.modal-backdrop` and `.modal` (lines 731–762)
     - `.metrics` and `.metric` (lines 518–553)
     - `.stop-loading-tag` (lines 3289–3307)
     - `.route-summary-cubagem-bar` (lines 3365–3375)

4. **LIFO Loading Order & Cubage Existing Assets**:
   - `components/routewise-app.tsx` lines 2670–2687 calculate LIFO loading order for stops:
     ```typescript
     const loadOrder = !isOrigin && stops.length > 1 ? stops.length - i : null;
     ```
     and renders:
     ```tsx
     <span className="stop-loading-tag">
       📦 {loadOrder}º a carregar ({loadOrder === 1 ? "porta" : "fundo"})
     </span>
     ```
   - Migration `db/migrations/0005_route_load_fields.sql` added `boxes integer DEFAULT 0` and `volume_m3 numeric(10,2) DEFAULT 0` to `route_stops`.

5. **Driver & Vehicle APIs & DB Engine**:
   - Drivers: `GET /api/drivers?all=true` returns all registered drivers for the company.
   - Vehicles: `GET /api/vehicles` returns all fleet vehicles for the company.
   - Route Creation & Dispatch: `app/api/[...path]/route.ts` lines 581–617 inserts into `routes` and `route_stops`. When `data.driverId` and `data.vehicleId` are present, `status` is set to `"assigned"`.
   - Database layer: `lib/db.ts` uses `@electric-sql/pglite` locally and `pg` in production. There is no Drizzle ORM configured in the repo.

---

## 2. Logic Chain

1. **Routing and Layout Architecture**:
   - Given that `app/page.tsx` mounts `RouteWiseApp` as an SPA, and `app/layout.tsx` imports global CSS and Leaflet styles, the Manager UI currently lives inside `Dispatcher` within `RouteWiseApp`.
   - To support the required URL path `/gestor/roteirizador` without breaking existing SPA state, an App Router route `app/gestor/roteirizador/page.tsx` should be created. This page will render `RouteWiseApp` with `defaultPortal="dispatcher"` and `defaultTab="roteirizador"`, while also adding the tab to `Dispatcher`'s sidebar navigation for seamless in-app switching.

2. **Design System Consistency**:
   - Because Tailwind CSS is not installed and all existing UI components (`.button`, `.modal`, `.panel`, `.metric`, `.status`, `.form-grid`, etc.) use semantic CSS from `app/globals.css` with CSS custom properties (`--navy: #14243a`, `--blue: #059669`), building the Roteirizador with these CSS classes guarantees 100% visual parity in both light and dark modes.

3. **LIFO Loading Order & Cubage Presentation**:
   - In transport logistics, LIFO loading means the delivery destination served first must be loaded last (at the door), while the delivery destination served last must be loaded first (at the back of the cargo bed).
   - Because `components/routewise-app.tsx` and `app/globals.css` already possess `.stop-loading-tag` and `.route-summary-cubagem-bar`, the Roteirizador UI can directly leverage this proven pattern to display loading order instructions.

4. **Driver & Vehicle Assignment & Immediate Driver Availability**:
   - Because `POST /api/routes` accepts `driverId`, `vehicleId`, and `stops`, setting `status = 'assigned'` during creation, the manager can assign drivers and vehicles directly in the "Suggested Routes" cards, and when clicking "Salvar e Despachar", the route is immediately stored and accessible in the driver's offline-ready app.

---

## 3. Caveats

1. **Tailwind Absence**: The prompt mentioned "Tailwind-based UI", but Tailwind is not configured in this project. Implementers should use the existing semantic CSS variables and utility classes in `app/globals.css` to avoid introducing build breaks or redundant dependencies.
2. **Spreadsheet Parsing Library**: `xlsx` (SheetJS) is not yet in `package.json`. CSV can be parsed without dependencies, but `.xlsx` requires installing `xlsx` or equivalent.
3. **Vehicle Capacity Column**: The `vehicles` database table does not have a `volume_capacity` column. Capacity limits (e.g., 20m³ or 30m³) are configurable in the UI / route engine parameters.
4. **No Drizzle ORM**: The prompt mentioned Drizzle ORM, but the codebase uses raw SQL with `pg`/`pglite`. Route creation should use the existing `POST /api/routes` endpoint or raw SQL queries in `lib/db.ts`.

---

## 4. Conclusion

The Manager UI in Criar Rota TMS is well-structured for the new Automated Routing Engine.
- **Placement**: Add `app/gestor/roteirizador/page.tsx` and integrate `"roteirizador"` tab into `components/routewise-app.tsx`.
- **UI Components**: Use `.spreadsheet-dropzone`, `.panel`, `.metric`, `.button.primary`, `.modal`, and `.stop-loading-tag` matching the `#14243a` (navy) and `#059669` (emerald) design system.
- **Dispatch**: Use `POST /api/routes` with `driverId` and `vehicleId` to create assigned routes in the database.

Full details are documented in `survey_manager_ui.md`.

---

## 5. Verification Method

To verify the findings:
1. **Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected: Clean completion with 0 errors.*
2. **Test Suite**:
   ```bash
   npm test
   ```
   *Expected: All 24 tests pass.*
3. **Inspect CSS Variables and Manager Components**:
   - Inspect `app/globals.css` lines 1–38 for `--navy` and `--blue` definitions.
   - Inspect `components/routewise-app.tsx` lines 1092–1293 for `Dispatcher` layout.
   - Inspect `survey_manager_ui.md` for complete architecture and integration plan.
