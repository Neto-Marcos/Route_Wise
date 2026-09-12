# Adversarial Review & QA Handoff Report: Client-Side Photo Compression & Idempotent Offline Queue

> [!WARNING] **Skepticism Disclaimer**
> Deep automated test suites and end-to-end verification pass 100% (16/16 unit/integration tests and 22/22 full-system E2E tests), but native mobile OS background task termination while the camera hardware is open cannot be directly exercised in a headless desktop test environment.

---

## 1. What the Prior Attempt Got Wrong

### Issue 1: Fatal Proof Deletion on Session Expiry (HTTP 401/403)
- **Input:** Driver operates offline, records delivery proofs, and the driver session cookie expires in the background. Connectivity recovers, triggering `flushQueue()`. The server responds with `HTTP 401 Unauthorized` or `HTTP 403 Forbidden`.
- **Expected:** The offline queue must NOT discard the driver's delivery proof. It should pause the queue and retain the delivery proofs so that once the driver re-authenticates or the token is refreshed, the delivery events and photos flush safely without data loss.
- **Actual:** `lib/offline.ts` classified any status `res.status >= 400 && res.status < 500 && res.status !== 429` as "permanent client error" and called `delete(item.id)`, permanently erasing all offline delivery proofs captured by the driver.
- **Root Cause:** Status code classification failed to separate transient authentication/authorization barriers (`401` / `403`) from permanent bad-request data errors (`400` / `404`).

### Issue 2: Dropped Proof on Device Storage Exhaustion (`QuotaExceededError`)
- **Input:** Driver's smartphone has low free disk space (< 50MB) or browser IndexedDB quota is exhausted, causing `tx.objectStore(STORE).put(record)` or `idb.open()` to reject with `QuotaExceededError`.
- **Expected:** `enqueue()` must catch the quota error and gracefully fall back to the in-memory fallback store (`memoryStore`), and `getQueueItems` / `flushQueue` must read from and drain both IndexedDB and `memoryStore`.
- **Actual:** `enqueue()` had an unhandled promise rejection that bubbled up as an uncaught exception to `ProofModal`. The delivery proof was never stored, despite the previous handoff report claiming that `memoryStore` was used as a fallback. Furthermore, `getQueueItems()` previously completely ignored `memoryStore` whenever `indexedDB` was defined in the environment.
- **Root Cause:** Absence of try/catch around `openDB()` / `tx.put()` in `enqueue()`, plus unidirectional reading in `getQueueItems()` that ignored `memoryStore`.

### Issue 3: Indefinite Flush Freeze on Stalled Cellular Connection
- **Input:** Driver transitions through an elevator, basement, or edge cell tower with high packet loss where the TCP connection stalls.
- **Expected:** The network request in `flushQueue()` must time out (e.g. 20-25s), abort cleanly, break the flush loop, and keep all queued items intact for retry.
- **Actual:** `fetch(item.url, ...)` had no `AbortSignal` or timeout. Stalled cellular connections kept `fetch` pending indefinitely, leaving `isFlushing = true` locked and permanently freezing future offline queue flushes.
- **Root Cause:** Unbounded `fetch` without `AbortController` timeout handling.

### Issue 4: Orphaned Items When Deliveries Are Enqueued During an Active Flush
- **Input:** A driver or background tracker enqueues a new delivery (or location point) while `flushQueue()` is actively transmitting an earlier delivery.
- **Expected:** The queue should drain all pending items, ensuring newly enqueued operations are not stranded.
- **Actual:** `flushQueue()` took a one-shot snapshot of `items` at the beginning of the function. Any operation enqueued while that batch was in-flight remained in the queue when `isFlushing` reset to `false`, leaving it stranded until the next network reconnect or page reload.
- **Root Cause:** The flush function lacked a drain loop to check for newly enqueued items before releasing the concurrency mutex.

### Issue 5: Infinite 500 Retry Loop on Replaying `start` and `finish` Route Handlers
- **Input:** `routes/[id]/start` or `routes/[id]/finish` was queued offline, accepted by the server, but network dropped before the driver received the 200 response. On network recovery, `flushQueue()` replayed the request.
- **Expected:** The server should detect that the route is already active or already completed and return an idempotent 200 OK, allowing `flushQueue()` to dequeue the item.
- **Actual:** The server threw `Error("Rota já iniciada ou finalizada")` or `Error("Rota precisa estar em andamento...")`, resulting in an HTTP 500 error. Because `flushQueue` preserves items on 5xx errors, the queue entered an infinite retry loop on every reconnection.
- **Root Cause:** Server route handlers lacked idempotent checks for routes already in `active` or `completed` states upon replay.

### Issue 6: Noisy/High-Frequency Camera Photos Exceeded 350KB Limit
- **Input:** High-noise camera captures (e.g. low light, gravel, barcode textures) where WebP compression at 1600x1200 remains > 800KB even at quality 0.30.
- **Expected:** Compression must strictly guarantee `< 350KB` as mandated by Acceptance Criteria 1, dynamically scaling dimensions down if quality reduction alone is insufficient.
- **Actual:** The step-down loop stopped at `q > 0.35` (or `q > 35` in Node) and returned the oversized image (> 800KB).
- **Root Cause:** The loop only stepped down quality and lacked adaptive dimension downscaling.

### Issue 7: Form Submission via Keyboard Enter Bypassed WebP Compression
- **Input:** Driver attaches a photo, and while "Otimizando imagem..." is active, presses Enter in an input field (`kilometers` or `note`).
- **Expected:** Form submission must be guarded until compression completes.
- **Actual:** `submit(e)` had no `if (compressing) return;` guard. It proceeded with `blobToSend = selectedFile` (the raw 10MB uncompressed JPEG) and empty `compressedBase64`.
- **Root Cause:** Missing `if (compressing) return;` guard in `submit` handler in `components/routewise-app.tsx`.

### Issue 8: Mobile RAM Spikes from `FileReader.readAsDataURL`
- **Input:** Processing large 12-48MP camera images in `HTMLCanvasElement` fallback.
- **Expected:** Efficient memory allocation using native blob URLs.
- **Actual:** `reader.readAsDataURL(file)` duplicated the 15MB file into a 20MB+ base64 string in V8 heap memory, risking tab crashes under memory pressure on mobile devices.
- **Root Cause:** Using `FileReader.readAsDataURL` instead of `URL.createObjectURL` and `URL.revokeObjectURL`.

### Issue 9: `calculateDimensions` with NaN/Non-Finite Inputs Returned NaN
- **Input:** `calculateDimensions(NaN, 1200)` or `calculateDimensions(0, 0)`.
- **Expected:** Sanitized dimensions returning positive integers within bounds.
- **Actual:** Returned `{ width: NaN, height: 1200 }`, which throws `DOMException` when applied to canvas width/height.
- **Root Cause:** Unsanitized arithmetic on non-finite input values.

---

## 2. What I Changed

### `lib/driver-photo.ts`
- **Adaptive Dimension & Quality Step-Down Loop**:
  - In `OffscreenCanvas`, `HTMLCanvasElement`, and Node.js (`sharp`), the compression loop now steps down quality (`0.70 -> 0.30`), and if the image is still `> 350KB` (e.g. extreme noise or complex texture), adaptively scales dimensions down by 15% iteratively until it strictly fits under `350KB`.
  - Guaranteed compliance with Acceptance Criteria 1 even on worst-case 100% random noise images.
- **Memory Optimization**:
  - Replaced `FileReader.readAsDataURL` with `URL.createObjectURL(file)` and `URL.revokeObjectURL(url)` in `HTMLCanvasElement` fallback to eliminate RAM duplication.
  - Added `{ imageOrientation: "from-image" }` support to `createImageBitmap` for proper EXIF orientation handling.
- **Input Sanitization**:
  - Sanitized `calculateDimensions` to guarantee non-zero, finite integer dimensions for any input (including `NaN`, `0`, or negative values).

### `lib/offline.ts`
- **`QuotaExceededError` Resiliency**:
  - Wrapped IndexedDB `openDB` and `tx.objectStore.put` in `enqueue` with try/catch fallback to `memoryStore`.
  - Updated `getQueueItems` to merge both `memoryStore` and IndexedDB records (deduplicated by `id`).
  - Implemented `deleteQueueRecord` helper to safely purge completed items from both storage tiers.
- **Session Expiration Protection**:
  - Updated status code inspection in `flushQueue()`: `401 Unauthorized` and `403 Forbidden` now pause the queue and NEVER delete driver proofs, ensuring work is preserved until re-authentication.
- **Drain Loop & Concurrency Safety**:
  - Wrapped `flushQueue()` in a continuous drain loop `while (true)` so operations enqueued while earlier items are in-flight are immediately processed before the mutex is released.
- **Request Timeout**:
  - Added `AbortController` with a 25-second timeout signal to `fetch()` in `flushQueue()` to prevent stalled cellular connections from hanging the offline queue indefinitely.
- **String Payload Support**:
  - Automatically parses JSON string bodies in `enqueue()` to inject `operationId` and `idempotencyKey`.

### `app/api/[...path]/route.ts`
- **Deterministic Photo Keys**:
  - Derived `photoKey` directly from `data.operationId` (`proof/${opId}.${ext}`, `start/${opId}.${ext}`, `finish/${opId}.${ext}`) preventing duplicate disk writes and duplicate `upload_objects` records on replayed requests.
- **Idempotent Start & Finish**:
  - `/routes/[id]/start`: If route is already `active`, returns `{ ok: true, message: "Rota já em andamento", photoKey }` instead of throwing 500.
  - `/routes/[id]/finish`: If route is already `completed`, returns `{ ok: true, message: "Rota já finalizada", photoKey }` instead of throwing 500.

### `components/routewise-app.tsx`
- **Submission Guard**:
  - Added `if (compressing) return;` at the top of `submit(e)` in `ProofModal` to prevent submitting raw uncompressed photos via keyboard Enter.
- **Base64 Fallback**:
  - In `handleSelectedFile`, added `arrayBufferToBase64` fallback in the catch block so `compressedBase64` is never empty even if canvas encoding fails.
- **Offline Error Catch**:
  - Added `.catch(() => {})` to `reload()` in `ProofModal.onDone` to prevent uncaught promise rejections when completing stops offline.
- **Replay Optimization**:
  - Passed existing `photoKey` in `queueOfflinePayload` if presigned PUT upload already succeeded.

### `tests/offline-photo-queue.test.mjs`
- Added 6 new adversarial test cases covering:
  - Sanitization of `calculateDimensions` with `NaN` and `0`.
  - Adaptive downscaling of 100% noisy JPEG to strictly `< 350KB` WebP.
  - `QuotaExceededError` fallback to `memoryStore` and successful flush.
  - Retention of queue items on HTTP `401 Unauthorized` (zero data loss).
  - In-flight drain loop handling concurrent enqueues.
  - Graceful timeout abort handling retaining payloads in queue.
  - UI contracts for `compressing` submit guard and `arrayBufferToBase64` fallback.

---

## 3. Verification Record

### Deep Verification (ran actual tests)
1. **Full Automated Unit & Adversarial Test Suite (`npm test`)**:
   - Command: `npm test` -> `node --test tests/offline-photo-queue.test.mjs`
   - **Result**: 16 passed, 0 failed, duration ~4.12s.
     - `calculates aspect-ratio preserving dimensions capped at 1600x1200` (PASS)
     - `calculates dimensions safely with NaN, 0, or negative inputs` (PASS)
     - `converts ArrayBuffer to Base64 safely in chunks` (PASS)
     - `compresses high-frequency noisy image to strictly < 350KB using adaptive step-down` (PASS)
     - `Acceptance Criteria 1: Compresses a 5MB+ JPEG to < 350KB WebP before network transmission` (PASS: 10.90MB -> 333.5KB WebP)
     - `generates valid UUIDv4 idempotency keys` (PASS)
     - `Acceptance Criteria 2: Enqueues operations with idempotency keys and propagates operationId to body` (PASS)
     - `Acceptance Criteria 3: flushQueue flushes items with idempotency headers and deletes upon success` (PASS)
     - `Acceptance Criteria 3: Concurrency protection ensures flushQueue runs exactly once when called in parallel` (PASS)
     - `Acceptance Criteria 2: Retains payload safely in queue when fetch fails (simulated offline network drop)` (PASS)
     - `falls back to memoryStore when IndexedDB throws QuotaExceededError and flushes safely` (PASS)
     - `retains queue items when server responds with 401 Unauthorized or 403 Forbidden (preserves driver work)` (PASS)
     - `drains items enqueued concurrently while a flush is in-flight` (PASS)
     - `handles request abort / timeout gracefully and retains payload in queue` (PASS)
     - `Verifies UI indicator string contracts are present in components/routewise-app.tsx` (PASS)
     - `interacts directly with IndexedDB IDBDatabase transactions and stores` (PASS)

2. **Full End-to-End System Verification (`node scripts/verify-all.mjs`)**:
   - Command: Started production Next.js server (`next start`), ran `node scripts/verify-all.mjs`.
   - **Result**: 22 passed, 0 failed, duration ~5.2s.
     - Static assets & PWA manifest validation.
     - Dispatcher & driver authentication.
     - Route creation, driver assignment, vehicle rate validation.
     - Odometer start capture & verification.
     - Live GPS location transmission.
     - Delivery event completion.
     - **Acceptance Criteria 1 & 2**: Deliver Stop 2 using 5MB+ JPEG compressed to WebP (< 350KB) via offline payload.
     - **Acceptance Criteria 3**: Reconnecting / re-flushing does not duplicate delivery events (idempotent replay verified with 1 delivery event in DB).
     - Route finish, actual kilometers calculation, and delivery report details.

3. **TypeScript Typecheck (`npm run typecheck`)**:
   - Command: `tsc --noEmit`
   - **Result**: 0 errors, clean pass.

4. **Production Build (`npm run build`)**:
   - Command: `next build`
   - **Result**: Successfully compiled client and server bundles; all static and dynamic pages generated cleanly without any SSR or native module bundling issues.

### Shallow Verification (manual only)
- Verified visual DOM structure and styling for `.compression-status` ("Otimizando imagem...") and `.offline-status` ("Salvo offline. Aguardando rede...") in `ProofModal`.

### Unverified aspects
- Native mobile OS memory kill during background camera activation on real hardware with low RAM.
- Extremely slow physical flash memory write speeds under thermal throttling conditions.

---

## 4. Known Issues
- `Minor Robustness Risk`: In rare private browsing modes where both IndexedDB and LocalStorage are completely blocked and the user hard-refreshes the tab before reconnecting to the internet, in-memory queue items will be lost upon reload.
- `Minor Robustness Risk`: High-resolution 48MP+ raw photos captured on low-spec phones may take 1.5-2.5s to compress on the CPU thread if `OffscreenCanvas` runs synchronously; the UI displays the spinning indicator "Otimizando imagem..." to communicate progress.

---

## 5. Remaining Risk & Next Step
- **Status**: The task is complete. All 3 acceptance criteria (WebP compression < 350KB from 5MB+ JPEG, offline storage in IndexedDB `routewise-offline`, and idempotent queue flushing) have been independently broken, hardened, and verified with 16 automated tests and 22 end-to-end integration scenarios.
- **Next Step**: Deploy to staging environment for real-device driver acceptance testing in airplane mode.
