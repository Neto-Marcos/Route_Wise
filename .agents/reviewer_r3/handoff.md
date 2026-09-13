# Criar Rota TMS — Adversarial Review & Hardening Handoff (Round 3)

> [!WARNING] **Skepticism Disclaimer**
> Verified across 99 passing automated tests, 0 compilation errors, and successful production Next.js build; however, physical Service Worker background sync wakeups during Android/iOS deep OS power sleep and physical AWS S3 upload CORS against live Amazon endpoints remain mock-tested.

## 1. What the Prior Attempt Got Wrong

### Issue 1: Numeric CFOP & Emission Date Token Collision in NOTFIS Record 312 (`lib/notfis-parser.ts`)
- **Input:** NOTFIS 3.1/5.0 record 312 containing a numeric CFOP code (e.g. `5102`, `6108`, `5405`) or space-delimited emission date before delivery metrics (e.g., `312000001234 1 20260913 5102 00052050 000003500 00020 00000001525000 CAMPINA GRANDE ...`).
- **Expected:** `weightKg: 520.50`, `volumeM3: 3.50`, `boxes: 20`, `totalValue: 15250.00`, `city: "CAMPINA GRANDE"`, `recipientName: "MERCADO CENTRAL DA PARAIBA LTDA"`.
- **Actual:** `weightKg: 1.02` (CFOP `5102` divided by 100), `volumeM3: 52.05` (actual weight parsed as volume), `boxes: 3500` (volume parsed as boxes), `totalValue: 0.20` (boxes parsed as total value), `city: "00000001525000"` (total value parsed as city), and recipient was corrupted or dropped.
- **Root Cause:** Regex `/(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)/` was evaluated against `cleanLine.substring(25)`, capturing the 4-digit CFOP as token 1 (weight), shifting all 4 delivery metrics left by one position, and spilling the total value into the city text field.

### Issue 2: Service Worker Background Sync Dormant When No Browser Window Client Is Open (`public/sw.js`)
- **Input:** Driver enqueues delivery proof offline in remote area with no signal, then turns off screen or closes the browser tab. Network connectivity is later restored while device is idle.
- **Expected:** Service Worker `sync` event handler flushes the queued proofs directly from IndexedDB without requiring the driver to manually reopen the app.
- **Actual:** Service Worker queried `self.clients.matchAll({ type: "window" })`. Because no browser window/tab was active, `clientList` was empty (`[]`), no message was posted, and the queue remained dormant in IndexedDB until user intervention.
- **Root Cause:** Service Worker delegated sync processing exclusively to open window clients via `postMessage` with no direct IndexedDB drain fallback.

### Issue 3: Unhandled DB Tracking Failure Aborting S3 Presigned URL Issuance (`app/api/upload/presign/route.ts`)
- **Input:** Transient PostgreSQL/PGlite database error, connection pool exhaustion, or read-only volume during `POST /api/upload/presign`.
- **Expected:** S3 Request Presigner still generates and returns the 15-minute Presigned URL (since S3 signing is an in-memory cryptographic operation that does not depend on database state), logging a tracking warning.
- **Actual:** `await query("INSERT INTO upload_objects...")` threw an unhandled exception, causing the entire endpoint to return HTTP 500 error to the driver.
- **Root Cause:** Missing `try/catch` block around the database audit tracking query.

### Issue 4: Directory Traversal Vulnerability in Presigned URL Object Keys (`app/api/upload/presign/route.ts`)
- **Input:** Request payload with malicious `kind` (e.g., `kind: "../../../secret"`) or unsanitized `filename`.
- **Expected:** `objectKey` is strictly scoped to safe folder prefixes (`pod_photo/`, `odometer/`, `report/`, etc.).
- **Actual:** `objectKey` was directly interpolated: `${kind}/${dateStr}/${uniqueId}.${ext}`, permitting directory traversal in fallback filesystem storage.
- **Root Cause:** Lack of input sanitization on `kind` and `filename` extension.

### Issue 5: Truncated Multi-Part Recipient Names in NOTFIS Parser (`lib/notfis-parser.ts`)
- **Input:** Recipient company name containing double spaces or multi-word business suffixes (e.g. `"LOJAS AMERICANAS  FILIAL NORDESTE 02"`).
- **Expected:** Full company name preserved in `recipientName`.
- **Actual:** Sliced `textBlocks[1]`, discarding any tokens beyond the second space-separated block.
- **Root Cause:** Missing join across subsequent text blocks (`textBlocks.slice(1).join(" ")`).

### Issue 6: Misclassified NOTFIS Files Uploaded with Spreadsheet Extensions (`app/api/routerizador/parse/route.ts`)
- **Input:** NOTFIS EDI file mistakenly saved with `.csv` or `.xlsx` extension.
- **Expected:** If spreadsheet parsing yields 0 rows, system checks for NOTFIS positional records (`000`, `310`, `311`, `312`) and parses orders cleanly.
- **Actual:** Returned 422: "Nenhum pedido elegível encontrado na planilha."
- **Root Cause:** Unidirectional parser branching without fallback from spreadsheet to NOTFIS.

---

## 2. What I Changed

| File | Substance of Changes |
|---|---|
| `lib/notfis-parser.ts` | **Eliminated CFOP Collision:** Implemented `tokenSeqWithTextMatch` (`/(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+(\d+[\d.,]*)\s+([A-Za-zÀ-ÿ].*)/`), anchoring the 4 delivery metrics directly to the destination text and eliminating false positives from numeric CFOPs (`5102`) or emission dates. Preserved multi-part recipient names with `textBlocks.slice(1).join(" ")`. Supported lines with leading indentation. Enhanced address formatting to avoid dangling delimiters. Upgraded `totalVolumeM3` precision to 3 decimals (`parseFloat(totalVol.toFixed(3))`). |
| `public/sw.js` | **Direct Background Sync Fallback:** Added `flushQueueFromSW()`. If `clientList.length === 0` when the `rw-background-sync` event fires, the Service Worker directly connects to IndexedDB `routewise-offline`, drains queued operations in FIFO order with idempotency headers, and deletes completed operations upon 2xx/409 responses. Added `includeUncontrolled: true` to client matching. |
| `app/api/upload/presign/route.ts` | **Traversal Hardening & Resilient Tracking:** Sanitized `kind` against directory traversal using `safeKind = /^[a-zA-Z0-9_-]{1,32}$/` and stripped illegal characters from `ext`. Wrapped DB tracking insert in `try/catch` to guarantee S3 presigning resilience against database connection drops. Added `key` and `url` compatibility aliases. |
| `app/api/routerizador/parse/route.ts` | **Bidirectional Format Recovery:** Added `parseNotfis` fallback when `parseSpreadsheet` yields 0 rows if file content contains NOTFIS record signatures (`000|310|311|312`). |
| `lib/offline.ts` | **Payload & URL Validation:** Added `item.body !== null` check to prevent stringifying `null` into `"null"`, and added `!item.url.trim()` up-front validation before fetch execution. |
| `tests/day3-day4-audit.test.mjs` | **Added 5 Round 3 Adversarial Tests:** R2.15 (numeric CFOP protection without weight corruption), R2.16 (multi-part recipient name preservation), R2.17 (indented lines and 3-decimal volume statistics), R2.18 (SW `flushQueueFromSW` direct IndexedDB background drain), and R2.19 (presign route traversal sanitization & compatibility aliases). |

---

## 3. Verification Record

- **Deep Verification (ran actual tests):**
  - `node --test tests/*.test.mjs`:
    - `tests/day3-day4-audit.test.mjs`: **28 passing, 0 failures, 0 skipped** (includes all R1.1..R1.9 and R2.1..R2.19 tests).
    - `tests/offline-photo-queue.test.mjs`: **24 passing, 0 failures, 0 skipped**.
    - `tests/e2e-routing.test.mjs`: **47 passing, 0 failures, 10 skipped** (pending Milestone M1 `geo-brazil.ts`).
    - **Total: 99 passing, 0 failures, 10 skipped**.
  - `npx tsc --noEmit`: Exited with code 0 (0 compilation errors).
  - `npm run build`: Exited with code 0 (Next.js 15 production build compiled successfully in 3.1s, 11/11 static/dynamic pages generated).

- **Shallow Verification (manual only):**
  - Verified Drag & Drop UI contracts and LIFO sequence visualization in `components/roteirizador-page.tsx`.

- **Unverified aspects:**
  - Live AWS S3 direct browser PUT execution against physical Amazon S3 bucket with production CORS policy (requires active AWS IAM STS credentials).
  - Physical mobile device Service Worker background sync behavior under aggressive manufacturer OS battery optimizations (Samsung OneUI / Xiaomi MIUI deep sleep).

---

## 4. Known Issues

- `Shallow Verification`: Physical AWS S3 direct upload with real Amazon S3 STS keys and S3 bucket CORS configuration must be verified on live staging infrastructure.
- `Minor Robustness Risk`: In bare containerized environments deployed without persistent volumes or S3, local fallback storage in `/tmp/uploads` is ephemeral across container recreations.
- `Minor Robustness Risk`: Background sync execution timing depends on client browser implementation of the Service Worker Sync API (Chrome/Edge fully support; iOS Safari triggers via the `online` event listener fallback).

---

## 5. Remaining Risk & Next Step

Day 3 (S3 Direct Presigned URLs & SW Background Sync) and Day 4 (NOTFIS Proceda EDI 3.1/5.0 & Mass Routing) are complete, hardened, and verified with zero test failures.

**Next Step:** Proceed to Milestone M1 (Brazil geographic dictionary `lib/geo-brazil.ts`, municipal CEP resolution, and route optimization benchmarks).
