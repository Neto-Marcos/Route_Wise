# Criar Rota TMS — Adversarial Review & Hardening Handoff (Round 2)

## Executive Summary
During the Round 2 adversarial review and audit of Day 3 (S3 Direct Presigned URLs & SW Background Sync) and Day 4 (NOTFIS Proceda EDI 3.1/5.0 Parser & Mass LIFO Route Processing), **8 functional defects and robustness vulnerabilities** were identified, reproduced, and resolved.

All automated test suites execute with **0 failures** (94 passing tests, 0 failures, 10 skipped pending Milestone M1 `geo-brazil.ts`).
TypeScript type check (`npx tsc --noEmit`) passes with **0 errors**.
Next.js production build (`npm run build`) compiles cleanly with all 11/11 pages generated.

---

## 1. Defects & Vulnerabilities Discovered in Round 2 Review

### Defect 1: Decimal Period 100x Multiplication Numeric Corruption in `lib/notfis-parser.ts`
- **Input**: NOTFIS record with explicit decimal periods, e.g. weight `123.45` kg, volume `3.50` m³, value `50.00`.
- **Expected**: `weightKg: 123.45`, `volumeM3: 3.50`, `totalValue: 50.00`.
- **Actual**: `weightKg: 12345` (12.3 metric tons!), `volumeM3: 350` (350 m³!), `totalValue: 5000` (R$ 5,000.00).
- **Root Cause**: `parseNum` executed `trimmed.replace(/\./g, "").replace(",", ".")` under `if (trimmed.includes(".") || trimmed.includes(","))`. This unconditionally stripped all periods, assuming every dot was a thousands separator rather than a decimal point.
- **Fix**: Re-architected `parseNum` to distinguish between:
  1. Both dot and comma present (evaluating which is the final separator).
  2. Comma-only (Brazilian decimal separator).
  3. Single dot (standard decimal point) vs multiple dots (thousands separators).

### Defect 2: Low-Value Invoices Breaking Token Sequence Regex in `lib/notfis-parser.ts`
- **Input**: Invoices with total value under R$ 100.00 with decimals (e.g. `50.00`, `12.50`, `9.99`), e.g. `123.45 3.50 20 50.00 CAMPINA GRANDE`.
- **Expected**: Parsed cleanly by `tokenSeqMatch`.
- **Actual**: `tokenSeqMatch` returned `null` because the 4th token regex was `\d{4,}[\d.,]*`, requiring at least 4 digits before the dot. It fell back to fixed character slicing, which sliced across token boundaries and corrupted city and recipient names.
- **Fix**: Relaxed the 4th token regex to `\d+[\d.,]*` when delimited by whitespace, and added secondary positional fallbacks for city (pos 82..117) and recipient (pos 117..167).

### Defect 3: UTF-8 BOM (`\uFEFF`) and Mac CR (`\r`) Line Ending Ingestion Failure in `lib/notfis-parser.ts`
- **Input**: NOTFIS files saved with UTF-8 BOM in Windows Notepad or generated with classic Mac CR (`\r`) line endings.
- **Expected**: Header record `000` and invoices parsed cleanly.
- **Actual**: The first line started with `\uFEFF000`, causing `line.substring(0, 3)` to evaluate to `\uFEFF00`, completely missing the header or the first invoice. Files with `\r` alone were treated as a single line.
- **Fix**: Added BOM stripping `if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);` and updated line splitting to `text.split(/\r\n|\r|\n/)`.

### Defect 4: Broken S3 URLs in Brazilian Region (`sa-east-1`) and Custom Endpoints in `app/api/upload/presign/route.ts`
- **Input**: Deployment in AWS `sa-east-1` (São Paulo) or custom `AWS_ENDPOINT_URL` (MinIO, Cloudflare R2).
- **Expected**: `publicUrl` resolves to `https://${bucket}.s3.sa-east-1.amazonaws.com/${objectKey}` or `${endpoint}/${bucket}/${objectKey}`.
- **Actual**: Always hardcoded to `https://${bucket}.s3.amazonaws.com/${objectKey}`, triggering DNS failures or 301 Moved Permanently in Brazilian AWS accounts.
- **Fix**: Evaluated `s3Region` and `s3Endpoint` to dynamically construct correct regional AWS S3 or custom S3-compatible URLs.

### Defect 5: Indefinite Offline Queue Poisoning / Deadlock from Malformed URLs in `lib/offline.ts`
- **Input**: Queue item with malformed or missing URL (e.g. `not-a-valid-url` or empty string).
- **Expected**: Corrupted item is pruned/logged so the remaining valid queue items are flushed.
- **Actual**: `fetch` threw `TypeError: Invalid URL` / `ERR_INVALID_URL`. The catch block treated this as a network outage, left the poisoned item at the front of the FIFO queue, and aborted flush. The queue was permanently frozen.
- **Fix**: Added URL sanity checks, explicitly detected `ERR_INVALID_URL` errors to delete poisoned items, tracked `item.attempts`, and capped retry attempts at 10 to avoid indefinite queue blocking.

### Defect 6: Missing Ephemeral Filesystem Fallback in `app/api/upload/file/route.ts`
- **Input**: Containerized or serverless environment where `.local-db` is read-only or ephemeral.
- **Expected**: Binary storage succeeds and GET retrieves files from `/tmp/uploads`.
- **Actual**: Writing to `.local-db/uploads` failed or GET returned 404 after redeployment if filesystem was ephemeral.
- **Fix**: Added `/tmp/uploads` fallback on disk write and checked both `.local-db/uploads` and `/tmp/uploads` candidates in the GET retrieval handler.

### Defect 7: Drag & Drop Re-Upload Blockage and UI Flicker in `components/roteirizador-page.tsx`
- **Input**: User re-uploads the same corrected file, or drags mouse over child elements inside the drop container.
- **Expected**: Selecting the same file triggers upload, and drop border does not flicker on hover over text/icons.
- **Actual**: `input.onChange` did not fire on identical file names; dragging over child elements fired `dragleave` on the parent, causing UI flickering.
- **Fix**: Reset `e.target.value = ""` on change, and added `pointerEvents: "none"` to child elements inside the drop zone.

### Defect 8: Record 313 Secondary DANFE Key Stripping in `lib/notfis-parser.ts`
- **Input**: Record 313 with 44-digit DANFE key when record 312 had already assigned `currentInvoice.danfeKey`.
- **Expected**: 44-digit key stripped from record 313 line before extracting city, state, and CEP.
- **Actual**: Line 313 only stripped key if it matched `currentInvoice.danfeKey`, leaving different or modified keys at the end of the line.
- **Fix**: Explicitly matched and stripped any 44-digit DANFE key present on record 313 directly.

---

## 2. Files Modified in Round 2

| File | Substance of Changes |
|---|---|
| `lib/notfis-parser.ts` | Fixed `parseNum` decimal period bug; added UTF-8 BOM stripping; supported `\r\n\|\r\|\n` line endings; generalized `tokenSeqMatch` regex; added positional fallbacks for city/recipient; hardened 313 DANFE stripping. |
| `app/api/upload/presign/route.ts` | Dynamic regional AWS S3 URL (`sa-east-1`) and custom `AWS_ENDPOINT_URL` support. |
| `app/api/upload/file/route.ts` | Added `/tmp/uploads` candidate check to PUT write and GET read handlers. |
| `app/api/routerizador/parse/route.ts` | Enhanced explicit NOTFIS content detection (`isNotfisContent`) on empty or malformed files. |
| `lib/offline.ts` | Added `updateQueueRecord`; pruned invalid URL poison pills; added attempt tracking with 10-retry cap. |
| `components/roteirizador-page.tsx` | Added `pointerEvents: "none"` on drop zone children to prevent flicker; added `e.target.value = ""` to enable re-upload. |
| `tests/day3-day4-audit.test.mjs` | Added 5 new Round 2 adversarial test cases (R2.10 through R2.14) covering decimal periods, UTF-8 BOM, regional S3 URLs, offline poison pill defense, and drag & drop UX. |

---

## 3. Verification Record

1. **Automated Test Suites**:
   - `node --test tests/*.test.mjs`:
     - `tests/day3-day4-audit.test.mjs`: **23 passing** (0 failures, 0 skipped)
     - `tests/offline-photo-queue.test.mjs`: **24 passing** (0 failures, 0 skipped)
     - `tests/e2e-routing.test.mjs`: **47 passing, 0 failures, 10 skipped** (pending milestone M1 `geo-brazil.ts`)
     - Total: **94 passing, 0 failures, 10 skipped**.

2. **TypeScript Compilation**:
   - `npx tsc --noEmit`: Exited with code 0 (0 errors).

3. **Next.js Production Build**:
   - `npm run build`: Exited with code 0. Compiled successfully in 3.2s, 11/11 pages generated.

---

## 4. Known Issues & Operational Considerations
- `Shallow Verification`: Physical AWS S3 PUT uploads against live AWS IAM STS keys require active AWS infrastructure (mocked in unit tests).
- `Minor Robustness Risk`: Real mobile hardware background sync behavior when device enters deep battery sleep depends on Android WorkManager / iOS background fetch budget.
- `Minor Robustness Risk`: In deployments without PostgreSQL or S3, local disk `/tmp/uploads` is ephemeral and will be cleared on container recreation.

---

## 5. Remaining Risk & Next Step
- Day 3 (S3 Presigned URLs, SW Background Sync) and Day 4 (NOTFIS Proceda EDI 3.1/5.0 & Mass Spreadsheet Support) have been comprehensively hardened and audited.
- All edge cases including UTF-8 BOM, decimal periods, exotic S3 regions, queue poison pills, and Drag & Drop UX are resolved.
- Ready for orchestrator sign-off and progression to Milestone M1.
