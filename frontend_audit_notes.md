# Front-End Codebase Audit & Architectural Review (RouteWise 2.0)

**Project**: RouteWise / Criar Rota TMS  
**Scope**: Front-End Review, Component Inventory, Usability, Performance, and Architecture  
**Generated**: 2026-09-17  

---

## 1. Executive Summary

A comprehensive architectural and front-end code audit of RouteWise 2.0 was conducted across all React components (`components/*`), App Router pages (`app/*`), UI utilities and state managers (`lib/*`), and static public assets (`public/*`).

While the core offline IndexedDB queuing engine and client-side WebP compression mechanisms are solid and functionally robust, the front-end application layer exhibits critical architectural bottlenecks, pseudo-routing anti-patterns, security boundaries enforced only on the client, rendering performance churn (polling storms and localStorage flooding), and UI/UX friction points that impede operational efficiency.

This document compiles the complete component inventory, 16 concrete architectural findings with verbatim code evidence, root cause analyses, and actionable recommendations for the engineering team.

---

## 2. Front-End File Landscape & Component Inventory

| File Path | Lines | Role / Responsibility | Key Dependencies / Architectural Role |
|---|---|---|---|
| `app/layout.tsx` | 56 | Root HTML shell, PWA metadata, viewport, Leaflet CSS and `globals.css` import. | Pure server layout wrapper. |
| `app/page.tsx` | 3 | Root page rendering `<RouteWiseApp />`. | Delegates 100% of routing to a single client component. |
| `app/offline/page.tsx` | 2 | Offline fallback page for Service Worker CacheStorage. | Static fallback HTML. |
| `app/globals.css` | 4,874 | Custom CSS design system & utility classes. | 108KB pure CSS without Tailwind; contains repeated rule additions. |
| `components/routewise-app.tsx` | 5,397 | Monolithic application shell and client-side pseudo-router. | Manages 15+ sub-components, global auth state, polling timers. |
| `components/roteirizador-page.tsx` | 873 | Automated multi-step routing wizard (Upload, Config, Review, Success). | Spreadsheet parser, vehicle presets, LIFO sequence, dispatch action. |
| `components/dashboard-analytics.tsx` | 380 | Executive KPI analytics panel. | OTIF, Cost/KM, Cost % VFR, Monthly target progress, driver ranking. |
| `components/commercial-dashboard.tsx` | 25 | Minified commercial portfolio summary. | CIF/FOB freight breakdown, stock availability percentage for filial 281. |
| `components/operations-hub.tsx` | 116 | Operational hub (chat, receipts, payments review, push alerts). | 20s polling, Web Push API integration, VAPID key check. |
| `components/driver-live-map.tsx` | 665 | Driver in-route GPS and Leaflet map component. | Turn-by-turn route geometry, Lei 13.103 rest stop warnings, fuel stations. |
| `components/live-fleet-map.tsx` | 230 | Dispatcher live fleet map with real-time GPS coordinates. | Leaflet map, truck markers, click-through to route detail. |
| `components/route-detail-modal.tsx` | 512 | Detailed route inspection modal. | Start/finish odometer photos, stop delivery status, embedded route map. |
| `components/route-report-modal.tsx` | 250 | Printable Romaneio & prestação de contas modal. | Formatted A4 sheet, signatures, Excel export link, print iframe. |
| `components/route-chat-drawer.tsx` | 224 | Route-specific chat drawer. | Quick status chips, auto-scroll, 5s polling. |
| `components/payment-request-modal.tsx` | 105 | Cash advance / expense reimbursement modal. | Pix key/QR upload, receipt upload, admin approval workflow. |
| `components/city-heatmap-modal.tsx` | 155 | Modal displaying delivery stop concentration across cities. | Concentric circle markers for delivery density. |
| `components/ssw-tracking-view.tsx` | 264 | Embedded package tracking portal for SSW and Correios. | Iframe-based proxy viewer with DANFE and CNPJ tracking. |
| `lib/driver-photo.ts` | 505 | Client & Node WebP compression and dimension utilities. | OffscreenCanvas, HTMLCanvasElement, iterative step-down to <350KB. |
| `lib/offline.ts` | 508 | IndexedDB offline operations queue (`routewise-offline`). | UUIDv7 idempotency, background sync auto-flush, FIFO drain. |
| `lib/haptics.ts` | 52 | Vibration API wrapper for tactile mobile feedback. | Tap, success, error, warning vibration patterns. |
| `lib/print-document.ts` | 31 | Invisible iframe print injector. | Isolate DOM elements for clean printing. |
| `public/sw.js` | 162 | PWA Service Worker. | CacheStorage asset cache, Web Push, background sync. |
| `public/ROTEIRIZADOR_ENTREGAS_FUNCIONAL.html` | 2,407 | 2.01MB orphan prototype file. | Embedded SheetJS, Leaflet, standalone HTML router. |

---

## 3. Findings Summary Matrix

| Finding ID | Category | Impact | Severity | Primary Risk / Issue |
|---|---|---|---|---|
| **F-01** | Architecture & Navigation | High | P0 | Monolithic 5,397-line `routewise-app.tsx` using client-side pseudo-routing |
| **F-02** | Architecture & Navigation | High | P0 | Missing direct page `/gestor/roteirizador` promised in project specifications |
| **F-03** | Security & State | Critical | P0 | Client-controlled role tampering via `sessionStorage` & `X-RouteWise-Role` |
| **F-04** | Performance & Lifecycle | High | P1 | Polling storm (5s/10s/20s) and synchronous `localStorage` flooding |
| **F-05** | Security & Code Quality | High | P1 | Global window pollution in Leaflet popups (`window.__selectRoute`) |
| **F-06** | Memory & Lifecycle | Medium | P1 | Leaflet container destruction hack (`delete _leaflet_id`) causing memory leaks |
| **F-07** | Data Integrity | High | P1 | Artificial coordinate jittering altering real customer geographic coordinates |
| **F-08** | External Compliance | Medium | P1 | Direct browser fetch to public OSM Nominatim without identifying User-Agent |
| **F-09** | Visual Accuracy | Medium | P2 | Fake heatmap in `city-heatmap-modal.tsx` discarding intensity metrics |
| **F-10** | Bundle Size & Performance| High | P1 | Heavy SheetJS (`xlsx`) bundled into client despite server-side parser |
| **F-11** | Repository Hygiene | Medium | P2 | 2.01MB unused prototype file hosted in `public/` root |
| **F-12** | Usability & Dead Code | Medium | P2 | SSW Tracking ignores entered password and contains dead UI controls |
| **F-13** | Design System | Low | P2 | Hardcoded dark mode background colors (`#0b1120`) in table views |
| **F-14** | Code Maintainability | Medium | P2 | Duplicated helper functions (Haversine math, date formatting, duration) |
| **F-15** | Code Hygiene | Low | P3 | 20 unused Lucide icon imports across 8 component files |
| **F-16** | User Experience | High | P1 | Two competing, incoherent route planning experiences |

---

## 4. Detailed Architectural Findings

### 1. Monolithic 5,397-Line `routewise-app.tsx` & Client-Side Pseudo-Routing
- **Location**: `components/routewise-app.tsx` (Lines 206–428, 1034–5352)
- **Description**: Next.js App Router is configured, but `app/page.tsx` merely renders `<RouteWiseApp />`. Inside `routewise-app.tsx`, all navigation between Home, Dispatcher, Planner, Driver, and 9 internal tabs is managed by React state (`activePortal` and `tab`). Over 15 distinct sub-views reside in this single file.
- **Why It Is Problematic**:
  - Eliminates deep-linking: Users cannot bookmark or share links to specific views (e.g., `/gestor/roteirizador`, `/motorista`).
  - Browser Back and Forward buttons break or reload the application to the initial state.
  - Huge single-file bundle size hinders code-splitting and slows IDE tooling and type checking.
- **Root Cause**: The application originated as a single-page prototype and was never refactored into Next.js App Router directory routes.
- **Recommendation**: Decompose `routewise-app.tsx` into modular route folders (`app/(workspace)/gestor/...`, `app/(workspace)/motorista/...`) and extract nested components into standalone files under `components/`.

---

### 2. Missing Direct URL Page `/gestor/roteirizador`
- **Location**: `PROJECT.md` (Lines 10 & 23), `ORIGINAL_REQUEST.md` (Line 40), `app/gestor/` (Directory Missing)
- **Description**: Project documentation explicitly lists `app/gestor/roteirizador/page.tsx` as the entry point for dispatch managers. However, the `app/gestor/` directory does not exist. Navigating directly to `/gestor/roteirizador` results in an immediate 404 Not Found error.
- **Why It Is Problematic**: Direct URLs communicated to logistics teams or referenced in external systems fail. The feature is only reachable by logging in and clicking the sidebar tab.
- **Root Cause**: The routing wizard was implemented solely as an internal state tab inside `routewise-app.tsx` without creating the corresponding Next.js page route.
- **Recommendation**: Create `app/gestor/roteirizador/page.tsx` that verifies dispatcher session and mounts `RoteirizadorPage` cleanly.

---

### 3. Client-Controlled Role Tampering (`X-RouteWise-Role`) & Insecure Session State
- **Location**: `components/routewise-app.tsx` (Lines 166–174), `components/route-detail-modal.tsx` (Lines 152–155), `lib/offline.ts` (Lines 368–371, 395)
- **Description**:
  ```typescript
  const role = typeof window !== 'undefined' ? sessionStorage.getItem('rw_role') : null;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { 'X-RouteWise-Role': role } : {}),
      ...options?.headers,
    },
  });
  ```
- **Why It Is Problematic**:
  - Security boundary violation: Any user can open DevTools console and set `sessionStorage.setItem('rw_role', 'dispatcher')` or `'superadmin'`, elevating their permissions.
  - Fragility: `sessionStorage` does not persist across browser tabs, causing authentication loss when opening links in new tabs.
- **Root Cause**: Absence of server-verified HTTP-only session cookies with server-side middleware role validation.
- **Recommendation**: Enforce role authorization server-side using secure HTTP-only session cookies and Next.js middleware. Deprecate client-injected `X-RouteWise-Role` headers in production.

---

### 4. Polling Storm & Synchronous `localStorage` Snapshot Thrashing
- **Location**: `components/routewise-app.tsx` (Lines 1761, 1789–1793), `components/operations-hub.tsx` (Line 50), `components/route-chat-drawer.tsx` (Line 32)
- **Description**: Multiple uncoordinated intervals poll the server continuously:
  - Overview panel: Every 10 seconds polls 5 API endpoints and synchronously writes the entire dataset to `localStorage.setItem(DISPATCHER_OFFLINE_SNAPSHOT, ...)`.
  - Operations Hub: Every 20 seconds polls messages, receipts, and payments.
  - Route Chat: Every 5 seconds polls chat messages.
- **Why It Is Problematic**:
  - Synchronous `localStorage.setItem` blocks the JavaScript main thread during heavy JSON serialization, causing noticeable micro-stutters.
  - High risk of `QuotaExceededError` as routes and stops accumulate.
  - Drains battery and wastes bandwidth on mobile driver devices, continuing even when the browser tab is hidden.
- **Root Cause**: Polling logic was added incrementally per component without a centralized sync manager or visibility check.
- **Recommendation**: Implement a unified data sync hook that pauses polling when `document.hidden === true`. Transition live tracking and chat to Server-Sent Events (SSE) or WebSockets. Offload offline snapshots to IndexedDB.

---

### 5. Global Window Function Pollution in Leaflet Popups (`window.__selectRoute`)
- **Location**: `components/live-fleet-map.tsx` (Lines 60–62, 75, 80–85, 147)
- **Description**:
  ```typescript
  (window as any).__selectRoute = (id: string) => onSelectRoute(id);
  // and in popup HTML:
  <button class="popup-button" onclick="window.__selectRoute('${r.id}')">Ver detalhes da rota</button>
  ```
- **Why It Is Problematic**:
  - Pollutes the global window namespace and bypasses React's synthetic event lifecycle.
  - Injection risk: Unescaped string interpolation into raw HTML strings allows XSS or syntax breaks if route IDs contain quotes.
  - Fragile when multiple map instances exist simultaneously.
- **Root Cause**: Bridging imperative Leaflet HTML popups with React state without an adapter.
- **Recommendation**: Attach click handlers to DOM elements via Leaflet event listeners (`marker.on('popupopen')`) or use React 19 `createPortal` into the Leaflet popup container.

---

### 6. Leaflet Container Lifecycle Hack (`delete _leaflet_id`)
- **Location**: `components/driver-live-map.tsx` (Lines 213–215), `components/live-fleet-map.tsx` (Lines 42–44), `components/city-heatmap-modal.tsx` (Lines 32–34), `components/routewise-app.tsx` (Lines 4079–4081)
- **Description**:
  ```typescript
  if ((mapElement.current as any)._leaflet_id) {
    delete (mapElement.current as any)._leaflet_id;
  }
  ```
- **Why It Is Problematic**:
  - Manually deleting private internal properties from the DOM node bypasses Leaflet's internal registry without invoking `map.remove()`.
  - Leaves previous map instances, event handlers, and tile loaders orphaned in memory, causing progressive memory leaks.
- **Root Cause**: Suppressing Leaflet's "Map container is already initialized" runtime exception during React strict mode double-mounting instead of implementing proper cleanup.
- **Recommendation**: Maintain map instances in a React `useRef`, call `mapRef.current?.remove()` in the effect cleanup function, and only instantiate when the container is clean.

---

### 7. Artificial Coordinate Jittering Corrupting Real Geographical Data
- **Location**: `components/routewise-app.tsx` (Lines 3239–3242, 4171–4176), `components/driver-live-map.tsx` (Lines 285–290)
- **Description**:
  ```typescript
  if (stops.some((s) => Math.abs(s.lat - lat) < 0.0001 && Math.abs(s.lng - lng) < 0.0001)) {
    lat += 0.00025 * (stops.length + 1);
    lng += 0.00025 * (stops.length + 1);
  }
  ```
- **Why It Is Problematic**:
  - Arbitrarily offsets real customer GPS coordinates by 25 to 50+ meters in unpredictable directions.
  - Corrupts actual location data in database records and driver navigation routes just to solve a visual marker overlap issue.
- **Root Cause**: Conflating data persistence models with visual map presentation.
- **Recommendation**: Keep real GPS coordinates intact. Use standard map marker clustering libraries (`leaflet.markercluster`) or visual spiderfier algorithms (`OverlappingMarkerSpiderfier`) purely in the render layer.

---

### 8. Direct Client Call to Public OSM Nominatim Without User-Agent
- **Location**: `components/routewise-app.tsx` (Lines 3201–3204)
- **Description**: Address geocoding triggers a direct browser fetch to:
  `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=br&q=...`
- **Why It Is Problematic**:
  - Directly violates OpenStreetMap Nominatim Usage Policy, which requires an identified User-Agent and strictly prohibits direct client-side web application queries.
  - Browsers forbid setting custom `User-Agent` headers on `fetch()` calls, resulting in 403 Forbidden responses and potential company IP range blacklisting.
- **Root Cause**: Quick prototype integration without an intermediate proxy endpoint.
- **Recommendation**: Proxy all geocoding requests through an authenticated backend route (`/api/geocoding`) that attaches application identity headers and implements server-side caching.

---

### 9. Fake Heatmap in `city-heatmap-modal.tsx`
- **Location**: `components/city-heatmap-modal.tsx` (Lines 45–61)
- **Description**: The modal claims to render a "Heatmap de Concentração de Entregas", but iterates over points and draws two static Leaflet circles (radius 1800m and 600m), completely ignoring the computed `intensity` value:
  ```typescript
  points.forEach(([lat, lng, intensity]) => {
    L.circle([lat, lng], { radius: 1800, color: "#ea580c", fillColor: "#f97316", fillOpacity: 0.35, weight: 1.5 }).addTo(map);
    L.circle([lat, lng], { radius: 600, color: "#dc2626", fillColor: "#ef4444", fillOpacity: 0.75, weight: 0 }).addTo(map);
  });
  ```
- **Why It Is Problematic**:
  - Misleads operators by displaying static bullseye target rings instead of true density contours.
  - Severe rendering lag when hundreds of SVG circles are drawn onto the map DOM.
- **Root Cause**: Mock placeholder was implemented instead of a true kernel density estimation layer.
- **Recommendation**: Integrate `leaflet.heat` with Gaussian weighting or compute Voronoi density polygons.

---

### 10. Heavy SheetJS (`xlsx`) Bundled into the Client
- **Location**: `components/roteirizador-page.tsx` (Lines 21, 291–294)
- **Description**: `roteirizador-page.tsx` imports `parseSpreadsheet` from `lib/spreadsheet-parser.ts`, pulling the complete SheetJS (`xlsx`) library directly into the client-side JavaScript bundle.
- **Why It Is Problematic**:
  - Adds megabytes of uncompressed JavaScript to the client payload, slowing down initial page loads on mobile networks.
  - Redundant: The backend already provides dedicated server endpoints (`/api/routerizador/workbook` and `/api/routerizador/parse`) to parse files on the server.
- **Root Cause**: Dual-mode client/server parsing logic was introduced without code splitting.
- **Recommendation**: Offload spreadsheet parsing exclusively to the backend API via `FormData` upload.

---

### 11. 2.01MB Unused Static Prototype in `public/`
- **Location**: `public/ROTEIRIZADOR_ENTREGAS_FUNCIONAL.html` (2,013,646 bytes)
- **Description**: A monolithic legacy HTML file with embedded base64 scripts, Leaflet, and SheetJS sits in the public web root. Grep searches across the entire codebase confirm zero references.
- **Why It Is Problematic**:
  - Increases deployment artifact sizes and repository clone overhead.
  - Exposes an unmaintained, unauthenticated prototype interface to the public web.
- **Root Cause**: Legacy standalone prototype was committed into `public/` for testing and never cleaned up.
- **Recommendation**: Delete the file from `public/` or archive it in internal documentation.

---

### 12. SSW Tracking View Ignores Password & Contains Dead UI Controls
- **Location**: `components/ssw-tracking-view.tsx` (Lines 10–11, 57–62, 174–190)
- **Description**:
  - The UI renders an input for `cnpjPassword`, but the fetch request drops it:
    `const url = searchType === 'danfe' ? '/api/ssw/proxy?danfe=' + clean : '/api/ssw/proxy?cnpj=' + clean + '&dias=' + daysLimit;`
  - `daysLimit` is hardcoded to `"30"` with no dropdown to change it.
  - `onBack` callback is accepted in the component props but never rendered in JSX.
- **Why It Is Problematic**:
  - Gives users a false sense of security that password-protected queries are working.
  - Missing "Voltar" navigation traps users inside the view without a visible escape button.
- **Root Cause**: Incomplete feature integration.
- **Recommendation**: Pass `cnpjPassword` to the backend if supported, add the missing "Voltar" button, and expose or remove dead parameters.

---

### 13. Hardcoded Dark Mode Backgrounds in `roteirizador-page.tsx`
- **Location**: `components/roteirizador-page.tsx` (Lines 566, 600, 708)
- **Description**: Tables and card containers use hardcoded dark colors (`background: "#0b1120"`, `color: "#e2e8f0"`), while the parent page uses CSS custom properties (`var(--paper)`, `var(--ink)`).
- **Why It Is Problematic**:
  - When the user switches to the Light Theme, the table remains jarringly dark, breaking visual consistency.
- **Root Cause**: Inline styles were copy-pasted from a dark-mode-only prototype.
- **Recommendation**: Replace inline hex colors with CSS design system tokens (`var(--card)`, `var(--card-subtle)`, `var(--line)`, `var(--ink)`).

---

### 14. Code Duplication Across Multiple Components
- **Location**:
  - Haversine distance formula: `driver-live-map.tsx:140`, `roteirizador-page.tsx:116`, `routewise-app.tsx:5353`.
  - Date formatting (`formatDate` / `formatDateBR`): `routewise-app.tsx:196`, `route-report-modal.tsx:22`, `route-detail-modal.tsx:228`.
  - Route duration calculation: `route-report-modal.tsx:38`, `route-detail-modal.tsx:238`.
  - Time formatting: `route-report-modal.tsx:30`, `route-detail-modal.tsx:220`.
- **Why It Is Problematic**:
  - Violates DRY (Don't Repeat Yourself) principles. Bug fixes or localization updates applied in one component fail to propagate to others.
- **Root Cause**: Siloed development of individual modals and views without a shared utility module.
- **Recommendation**: Centralize all date, time, and geographic math into shared utility files (`lib/formatters.ts` and `lib/geo.ts`).

---

### 15. Dead Code: 20 Unused Lucide Icon Imports
- **Location**:
  - `commercial-dashboard.tsx`: `FileCheck2`, `PackageCheck`
  - `dashboard-analytics.tsx`: `Clock`, `Calendar`, `DollarSign`, `CheckCircle2`, `AlertTriangle`
  - `driver-live-map.tsx`: `Navigation`
  - `route-chat-drawer.tsx`: `Zap`
  - `route-detail-modal.tsx`: `ArrowLeft`, `CheckCircle2`, `FileText`, `UserRound`
  - `routewise-app.tsx`: `CheckCircle2`, `Download`, `Filter`, `Lock`, `MapIcon`
  - `ssw-tracking-view.tsx`: `RefreshCw`, `Maximize2`
- **Why It Is Problematic**:
  - Clutters source files, creates noise in bundle analysis, and triggers static analysis warnings.
- **Root Cause**: Leftover imports after visual redesigns.
- **Recommendation**: Remove all unused icon imports across the 8 affected files.

---

### 16. Two Competing, Incoherent Route Planners
- **Location**: `components/roteirizador-page.tsx` vs `RoutePlannerView` in `components/routewise-app.tsx`
- **Description**: The platform contains two completely independent routing tools with conflicting UX paradigms:
  1. `RoteirizadorPage` (Spreadsheet/EDI automated batch clustering and LIFO route generation).
  2. `RoutePlannerView` (Manual address search, map click-to-add, OSRM TSP solver).
  Clicking "Abrir no Mapa" in the automated tool exports data into a separate format and forces the user into the manual planner, which has different controls, different vehicle pickers, and different dispatch triggers.
- **Why It Is Problematic**:
  - High operator learning curve and operational confusion.
  - Duplicate maintenance burden for route submission and validation logic.
- **Root Cause**: The automated roteirizador was developed as an add-on feature rather than unifying the existing route planner.
- **Recommendation**: Merge both into a single unified Route Planner that allows importing files OR manually adding stops on an interactive map.

---

## 5. Verification & Audit Trail

All findings can be verified directly:
1. **Missing Route**: Running `Test-Path app/gestor` confirms no folder exists.
2. **Unused Imports**: Validated across all 8 component files.
3. **Nominatim Direct Call**: Inspected in `components/routewise-app.tsx:3201`.
4. **Leaflet Lifecycle**: Inspected in `live-fleet-map.tsx`, `driver-live-map.tsx`, and `roteirizador-page.tsx`.
5. **Jittering Math**: Inspected in `components/routewise-app.tsx:3239-3242`.
6. **Fake Heatmap**: Inspected in `components/city-heatmap-modal.tsx:45-61`.