# Original User Request

## 2026-09-12T17:56:41Z

This is a single self-contained feature enhancement; keep it small and focused.

Implement Client-Side Photo Compression and a robust Idempotent Offline Queue for the driver's delivery proof (POD) in the Criar Rota TMS. The goal is to resize heavy camera photos to WebP before network transmission and safely queue them in IndexedDB if the device is offline.

Working directory: C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise
Integrity mode: development

## Requirements

### R1. Client-Side WebP Compression
Update `lib/driver-photo.ts` to intercept the camera image capture. Use `HTMLCanvasElement` or `OffscreenCanvas` to resize the image (max 1600x1200px) and encode it as `image/webp` at 0.70 quality. This must happen before the file touches the fetch API.

### R2. Idempotent Offline Queue
Enhance `lib/offline.ts` to ensure operations queued in IndexedDB `routewise-offline` are stored with an idempotency key (e.g., UUIDv7 or `crypto.randomUUID()`). When the network recovers, `flushQueue` must process payloads reliably exactly once.

### R3. UI Feedback for Compression & Sync
Update the driver app UI (e.g., `components/routewise-app.tsx` inside the camera modal) to display lightweight status indicators (e.g., "Otimizando imagem...", "Salvo offline. Aguardando rede...").

## Acceptance Criteria

### Resilience & Efficiency
- [ ] A 5MB+ JPEG file provided to the photo input is successfully compressed to < 350KB WebP before network transmission.
- [ ] If the app is offline (simulated by dropping the fetch request), the compressed photo payload is safely stored in `routewise-offline` IndexedDB.
- [ ] Reconnecting to the network automatically flushes the queue without duplicating delivery events (idempotent submission).

## 2026-09-12T19:10:35Z

Implement the Automated Routing Engine for Criar Rota TMS based on Excel/CSV spreadsheets. The system must cluster delivery orders based on geographic proximity, maximum vehicle volume capacity (m³), and weight (kg), and assign the optimized routes to registered drivers.

Working directory: C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise
Integrity mode: development

## Requirements

### R1. Spreadsheet Upload & Parsing
Create a new feature in the Manager UI (e.g., `/gestor/roteirizador`) allowing the dispatch manager to upload an `.xlsx` or `.csv` spreadsheet containing order deliveries. The system must parse:
- Client / Recipient
- Delivery City / Address
- Order ID / Products
- Cubage (Volume in m³)
- Weight (kg) and Items Count

### R2. Clustering & Bin-Packing Algorithm (Route Engine)
Implement a server-side algorithm (e.g., `lib/route-engine.ts`) to group these deliveries into logical Routes.
- **Geographic Clustering**: Group orders in the same or nearby cities.
- **Vehicle Capacity Limit**: A route cannot exceed the standard volume capacity of the company's vehicles (e.g., 20m³ or 30m³). Once the limit is hit, the engine must split it into a new route.

### R3. Dispatch UI and Driver Assignment
Display the generated "Suggested Routes" visually in the UI.
- Show total routes, total m³ utilized, and number of stops per route.
- Allow the manager to select a registered Driver and Vehicle for each suggested route.
- Include a "Save and Dispatch" button that creates the `Route` and its `Stops` in the database, immediately making it available in the driver's offline-ready app.
- Provide loading order instructions (LIFO - Last In, First Out).

## Acceptance Criteria

### Performance and Usability
- [ ] Uploading a typical dispatch spreadsheet parses successfully and renders route suggestions in under 3 seconds.
- [ ] The algorithm mathematically guarantees no single route exceeds the defined capacity parameters (volume/weight).
- [ ] Once "Dispatched", the generated routes appear perfectly formatted in the driver's app, and the system correctly handles the DB insertions using Drizzle ORM.
- [ ] Tailwind-based UI matching the exact dark-blue/dashboard color palette of the existing system.

## 2026-09-13T14:23:23Z

This is a single self-contained audit and verification task; keep it small and focused.

Verify and audit that the implementation of Day 3 (S3 Direct Upload Presigned URLs & Background Sync) and Day 4 (NOTFIS Proceda EDI Parser & Batch Processing) in Criar Rota TMS strictly meet the architectural gold rules and functionality specifications of the 18-Day Playbook.

Working directory: C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise
Integrity mode: development

## Requirements

### R1. Audit Day 3 (Direct S3 Presigned Uploads & SW Background Sync)
- Verify `app/api/upload/presign/route.ts` correctly issues 15-min Presigned URLs via AWS S3 Request Presigner when S3 credentials are set, with a clean local fallback when omitted.
- Verify `public/sw.js` and `lib/offline.ts` register the `rw-background-sync` tag to automatically flush offline queued POD proofs upon network recovery.
- Confirm `lib/driver-photo.ts` helper (`uploadPhotoToStorage`) integrates WebP compression with S3 direct upload.

### R2. Audit Day 4 (NOTFIS EDI 3.1/5.0 Parser & Mass Spreadsheet Support)
- Verify `lib/notfis-parser.ts` accurately parses Proceda NOTFIS positional text files (`.txt`, `.not`, `.edi`), extracting 44-digit DANFE keys, invoice numbers, recipient address/city, volume (m³), weight (kg), and total values.
- Verify `app/api/routerizador/parse/route.ts` seamlessly accepts NOTFIS EDI alongside `.xlsx` and `.csv` files.
- Verify `components/roteirizador-page.tsx` UI correctly accepts NOTFIS files via Drag and Drop and processes them into LIFO routes.

## Acceptance Criteria

### Verification & Test Assurance
- [ ] Automated E2E verification test suite (`node --test`) executes cleanly with zero failures.
- [ ] `npx tsc --noEmit` returns 0 TypeScript compilation errors.
- [ ] `npm run build` succeeds cleanly without Next.js build errors.
- [ ] No regression introduced to existing driver offline app or manager routing UI.
