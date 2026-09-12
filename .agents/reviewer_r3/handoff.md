# Adversarial Review & QA Handoff Report (Round 3): Client-Side Photo Compression & Idempotent Offline Queue

> [!WARNING] **Skepticism Disclaimer**
> Deep verification covers 24 unit/adversarial tests and 25 end-to-end full-stack system scenarios passing at 100%, but physical camera hardware sensor interrupts and mobile OS background process termination while a raw camera frame is in memory cannot be simulated with pure software tests.

---

## 1. What the Prior Attempt Got Wrong

### Issue 1: Duplicate Delivery Events on Re-submission with New Operation ID or Rapid Double Clicks
- **Input:** Driver taps "Confirmar registro" twice in rapid succession, or re-submits a delivery proof after a connection drop where a new `operationId` was generated for an already-delivered stop.
- **Expected:** The server endpoint `/api/routes/[id]/deliveries/[stopId]/complete` must detect that the stop was already delivered, return 200 OK idempotently, and insert strictly zero duplicate records into `delivery_events`.
- **Actual:** The server only checked `SELECT photo_key FROM delivery_events WHERE operation_id=$1`. When called with a new `operationId` for the same stop, it inserted a second record into `delivery_events`, creating duplicate delivery events and violating Acceptance Criteria 3.
- **Root Cause:** The server-side idempotency query omitted `OR (route_id=$2 AND stop_id=$3)`, and the client modal lacked an instantaneous double-submission lock (`isSubmittingRef`).

### Issue 2: Optimistic UI Progression Cancelled when Dismissing Modal Early
- **Input:** Driver completes delivery proof offline. `queueOfflinePayload` schedules `setTimeout(() => onDone(), 1200)`. Driver taps the modal close button "X" or backdrop before the 1200ms delay elapses.
- **Expected:** The driver route view optimistically marks the stop as delivered and advances navigation to the next stop regardless of modal dismissal timing.
- **Actual:** `ActiveRoute` defined `onDone` reading parent state: `const currentPhase = modal; const currentStop = next;`. When the modal was closed, `setModal(null)` reset `modal` to `null`. When `onDone` fired from the timer, `currentPhase` was `null`, so the optimistic state updates (`currentPhase === "delivery"`) were completely skipped, leaving the driver stuck on the completed stop while offline.
- **Root Cause:** `onDone` relied on mutable parent component state variables (`modal`, `next`) instead of `ProofModal` explicitly passing `onDone(phase, stop)`.

### Issue 3: Cumulative IndexedDB Database Connection Leaks
- **Input:** Continuous offline usage where driver queues location points and delivery proofs, checks queue count, and flushes operations.
- **Expected:** Every IndexedDB connection opened via `openDB()` is cleanly closed when transactions complete or abort.
- **Actual:** `enqueue()`, `getQueueItems()`, `deleteQueueRecord()`, and `clearQueue()` opened connections via `openDB()` without ever calling `db.close()`. This accumulated dozens of unclosed connections, exhausting connection pools and causing transaction freezes on mobile browsers (iOS Safari / Android Chrome).
- **Root Cause:** Missing `db.close()` calls inside `tx.oncomplete`, `tx.onerror`, and `tx.onabort` callbacks.

### Issue 4: ImageBitmap Memory Leak on OffscreenCanvas Encoding Failures
- **Input:** Camera captures where `OffscreenCanvas.convertToBlob` throws an error or is unsupported by the platform WebView.
- **Expected:** The allocated `ImageBitmap` must always be closed to reclaim GPU/heap memory before falling back to `HTMLCanvasElement`.
- **Actual:** `bitmap.close()` was positioned after the step-down loop outside of a `finally` block. Any exception thrown during canvas allocation or `convertToBlob` aborted the function into `catch`, leaking the raw uncompressed bitmap (~48MB for a 12MP camera frame).
- **Root Cause:** Missing `try ... finally` block around `bitmap` usage.

### Issue 5: Photo Data Loss on Offline Sync when Photo Key Was Pre-assigned
- **Input:** Device attempts presigned PUT upload, receives a `photoKey`, but network drops before delivery completion. The operation is queued with both `photoKey` and `photoBase64`.
- **Expected:** When synced, the server persists `photoBase64` into `upload_objects.file_data` (bytea) so the POD photo survives disk cache purges and container restarts.
- **Actual:** Handlers checked `if (!photoKey && data.photoBase64)`. Because `photoKey` was already populated, the byte data was ignored and `upload_objects.file_data` remained NULL.
- **Root Cause:** Missing `UPDATE upload_objects SET file_data=COALESCE(file_data, $1) WHERE object_key=$2` fallback for pre-assigned keys.

### Issue 6: `TypeError: Failed to parse URL` in Node.js Environment on Relative Paths
- **Input:** `flushQueue()` invoked in Node.js, SSR, or worker environment with a relative path (e.g., `"/api/routes/..."`).
- **Expected:** `flushQueue()` resolves relative URLs against `process.env.APP_URL` or `http://localhost:3000`.
- **Actual:** Native Node.js `fetch` threw `TypeError: Failed to parse URL from /api/...`, halting the queue.
- **Root Cause:** Absence of base URL resolution for relative paths when `typeof window === "undefined"`.

---

## 2. What I Changed

### `app/api/[...path]/route.ts`
- **True Stop-Level Idempotency (`deliveries/[stopId]/complete`)**:
  - Enhanced query to `SELECT operation_id, photo_key FROM delivery_events WHERE operation_id=$1 OR (route_id=$2 AND stop_id=$3)`.
  - If already delivered, returns 200 OK immediately with existing `operation_id` and `photo_key`, preventing duplicate rows in `delivery_events`.
- **Pre-assigned Key Bytea Persistence**:
  - Added `UPDATE upload_objects SET file_data=COALESCE(file_data, $1), size_bytes=COALESCE(size_bytes, $2) WHERE object_key=$3` across `start`, `deliveries/.../complete`, and `finish` when both `photoKey` and `data.photoBase64` are present.
- **Odometer Reading Conflict Prevention**:
  - Added `ON CONFLICT (route_id, phase) DO UPDATE SET kilometers=EXCLUDED.kilometers, photo_key=EXCLUDED.photo_key, lat=EXCLUDED.lat, lng=EXCLUDED.lng` in `start` and `finish` handlers to prevent 500 errors on replayed submissions.

### `components/routewise-app.tsx`
- **Submission Lock in `ProofModal`**:
  - Added `isSubmittingRef` to instantaneously prevent re-entrancy from double clicks or double taps before React state re-renders the disabled button.
- **Explicit Pass-Through to `onDone(phase, stop)`**:
  - Updated `ProofModal` to pass `(phase, stop)` directly to `onDone`.
  - Updated `ActiveRoute.onDone(completedPhase, completedStop)` to use passed arguments `const currentPhase = completedPhase || modal; const currentStop = completedStop !== undefined ? completedStop : next;`, eliminating race conditions when the modal is dismissed early.
- **Explicit Role Header**:
  - Included `headers: { "X-RouteWise-Role": "driver" }` directly in `enqueue(...)` payload within `ProofModal` to protect against lost session storage.
- **Object URL Cleanup**:
  - Added `URL.revokeObjectURL(previewUrl)` on file selection and unmount to prevent memory leaks.

### `lib/offline.ts`
- **IDB Connection Lifetime Management**:
  - Added `db.close()` to `oncomplete`, `onerror`, and `onabort` handlers in `enqueue()`, `getQueueItems()`, `deleteQueueRecord()`, and `clearQueue()`.
- **Node.js Relative URL Resolution**:
  - In `flushQueue()`, added resolution of relative paths against `process.env.APP_URL || "http://localhost:3000"` when `typeof window === "undefined"`.

### `lib/driver-photo.ts`
- **Guaranteed ImageBitmap Cleanup**:
  - Enclosed `OffscreenCanvas` drawing, step-down compression, and blob conversion inside `try ... finally { try { bitmap.close(); } catch {} }` to prevent bitmap memory leaks on encode failures.

### `tests/offline-photo-queue.test.mjs`
- Added 3 new adversarial unit tests (increasing total to 24 tests):
  - Verified `mockDB.close()` is called on IndexedDB operations.
  - Verified `ImageBitmap` is closed in a `finally` block when `convertToBlob` throws.
  - Verified `flushQueue` resolves relative URLs with base URL in Node.js environment.
  - Verified `ProofModal` contains double-submit lock, explicit role header, and pass-through `onDone`.

### `scripts/verify-all.mjs`
- Added assertion verifying that replaying delivery completion with a **different operationId** for an already-delivered stop returns 200 OK idempotently and maintains strictly 1 delivery event in the database.

---

## 3. Verification Record

- **Deep Verification (ran actual tests):**
  - `npm test` (`node --test tests/offline-photo-queue.test.mjs`):
    - **Result**: 24 passed, 0 failed, duration ~3.02s.
    - Verified bounded step-down compression, OffscreenCanvas and HTMLCanvasElement browser engines, ImageBitmap finally cleanup, IDB database close calls, relative URL resolution, and UI contract indicators.
  - `npm run typecheck` (`tsc --noEmit`):
    - **Result**: 0 errors, clean pass across entire TypeScript codebase.
  - `npm run build` (`next build`):
    - **Result**: Production compilation succeeded in 4.4s; all routes and static assets compiled cleanly.
  - `node scripts/verify-all.mjs` (Full End-to-End System Suite):
    - **Result**: 25 passed, 0 failed, duration ~4.5s.
    - Verified all core TMS flows, WebP compression (< 350KB), offline queue delivery, duplicate replay with different operationIds (strictly 1 event in DB), route start/finish replay after completion, and POD photo bytea retrieval.

- **Shallow Verification (manual only):**
  - Inspected button disabled states (`disabled={busy || compressing || offlineSaved || (!selectedFile && !previewUrl)}`) and CSS layout in `ProofModal`.

- **Unverified aspects:**
  - Physical mobile OS background kill when the camera app acquires exclusive memory on low-end smartphones (< 2GB RAM).
  - Physical device flash memory write latency under extreme thermal throttling conditions.

---

## 4. Known Issues
- `Minor Robustness Risk`: In private browsing modes where both IndexedDB and LocalStorage are blocked and the browser tab is hard-reloaded while offline, in-memory queue items will be lost upon reload.

---

## 5. Remaining Risk & Next Step
- **Status**: The implementation is completely hardened, robust, and verified against adversarial edge cases. All 3 acceptance criteria (WebP compression < 350KB from 5MB+ JPEG, offline storage in IndexedDB `routewise-offline`, and idempotent queue flushing without duplicate events) have passed 24 unit/adversarial tests and 25 full-system E2E scenarios.
- **Next Step**: The task is complete. Ready for field pilot testing with delivery drivers in low-connectivity rural zones.
