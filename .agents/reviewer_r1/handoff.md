# Criar Rota TMS — Adversarial Review & Hardening Handoff (Round 1)

## Executive Summary
During adversarial review of the Day 3 (S3 Direct Presigned URLs & SW Background Sync) and Day 4 (NOTFIS Proceda EDI 3.1/5.0 Parser & Mass LIFO Route Processing) implementation, **4 functional defects and 4 robustness vulnerabilities** were identified, reproduced, and resolved.

All automated test suites execute with **0 failures** (89 passing tests, 0 failures, 10 skipped pending Milestone M1 `geo-brazil.ts`).
TypeScript type check (`npx tsc --noEmit`) passes with **0 errors**.
Next.js production build (`npm run build`) compiles cleanly with all 11/11 pages generated.

---

## 1. Defects & Vulnerabilities Discovered in Prior Attempt

### Defect 1: Numeric Field Slicing Collision with 44-Digit DANFE Keys in `lib/notfis-parser.ts`
- **Input**: NOTFIS line with 5-digit weight without leading zeros (e.g. `12345` = 123.45 kg) followed by 44-digit DANFE key `35260912345678000195550010000012341000012345`.
- **Expected**: `weightKg: 123.45`, `volumeM3: 3.50`, `boxes: 20`, `totalValue: 15250.00`.
- **Actual**: `weightKg: 3526091.23` (3.5 million kg!), `volumeM3: 456780.001` (456k m³!), `boxes: 955500`, `totalValue: 1000001234100` (1 trillion R$).
- **Root Cause**: The regex `/(\d{7,9})\s*(\d{7,9})\s*(\d{4,6})\s*(\d{10,15})/` failed on 5-digit weight and matched directly inside the 44-digit DANFE key at the end of the line, slicing the access key into fake weights and volumes. When fed to `route-engine.ts`, this immediately threw `Pedido excede a capacidade máxima do veículo` and crashed the routing engine.
- **Fix**: Extracted the 44-digit DANFE key with boundary assertions `(?<!\d)\d{44}(?!\d)` and stripped it from `cleanLine` before performing any numeric or text extraction. Added tokenized number sequence matching that flexibly supports numbers of any length.

### Defect 2: Proceda 3.1 Blank Romaneio Invoice Number Truncation in `lib/notfis-parser.ts`
- **Input**: Proceda 3.1 layout where Romaneio (positions 3..10) is blank/spaces, e.g. `312        00005678  1...`.
- **Expected**: `invoiceNumber: "00005678"`.
- **Actual**: `invoiceNumber: "00"` (and `orderId: "00"`).
- **Root Cause**: `line.substring(3, 13)` sliced 8 spaces followed by the first two digits of the invoice number (`"        00"`), which was trimmed to `"00"`, completely losing the real invoice number.
- **Fix**: Evaluated positions 11..20 (`p3Nf`) and positions 3..12 (`p5Nf`) with digit regex validation, plus fallback to SEFAZ NF-e number extracted from digits 25..34 of the 44-digit DANFE key.

### Defect 3: Positional Fallback Truthiness Bug in `lib/notfis-parser.ts`
- **Input**: Positional NOTFIS lines requiring positional fallback `line.substring(44, 53) || line.substring(63, 72)`.
- **Expected**: Fallback to position 63..72 if position 44..53 is empty.
- **Actual**: `line.substring(44, 53)` returned 9 spaces (`"         "`), which in JavaScript is truthy, completely preventing the `||` fallback from ever executing.
- **Root Cause**: Un-trimmed substring evaluations inside fallback chains.
- **Fix**: Wrapped substrings with `parseStr(...)` so spaces evaluate to `""` (falsy), allowing legitimate fallbacks.

### Defect 4: False NOTFIS 422 Rejection on CSV Uploads with MIME `text/plain` in `app/api/routerizador/parse/route.ts`
- **Input**: Upload of `pedidos.csv` where the browser or client reports MIME `text/plain`.
- **Expected**: Parsed as spreadsheet via `parseSpreadsheet`.
- **Actual**: `file.type.includes("text/plain")` triggered NOTFIS mode; `parseNotfis` found 0 invoices and returned HTTP 422 `"Nenhum documento/nota fiscal válida encontrada no arquivo NOTFIS."`.
- **Root Cause**: Overbroad NOTFIS detection based on MIME `text/plain` rather than checking file extension or content structure.
- **Fix**: Added `isSpreadsheetExt` check (`.xlsx`, `.xls`, `.csv`). Non-spreadsheet or `.txt`/`.not`/`.edi` files are attempted with `parseNotfis`; if 0 orders are found, they gracefully fall back to `parseSpreadsheet`.

### Defect 5: Record 313 Brazilian UF Extraction Failure with DANFE Key at Line End
- **Input**: Record 313 line ending with 44-digit DANFE key: `313RUA ... SAO JOSE DO RIO PRETO   SP 15000000 352609...`.
- **Expected**: `state: "SP"`, `city: "SAO JOSE DO RIO PRETO"`.
- **Actual**: `state: "0"` (digit from CEP/DANFE key due to hardcoded pos 108..110 fallback).
- **Root Cause**: The state regex anchored to `$` failed because the DANFE key was at the end of the line.
- **Fix**: Stripped the DANFE key first, matched against the 27 standard Brazilian UFs (`AC|AL|...|TO`), and cleaned UF and CEP tokens from the extracted city string.

### Defect 6: Missing Browser `online` Listener in `lib/offline.ts`
- **Root Cause**: Reconnection sync relied solely on Service Worker `sync` events (`rw-background-sync`), which are unsupported on iOS Safari and certain mobile environments.
- **Fix**: Added `window.addEventListener("online", () => flushQueue())` to ensure immediate queue drain upon reconnection across all platforms.

### Defect 7: Incomplete Fallback Storage Protocol in `app/api/upload/file/route.ts` & `app/api/upload/presign/route.ts`
- **Root Cause**: `app/api/upload/file/route.ts` only handled `PUT` and `POST`, returning 405 Method Not Allowed on `GET` requests. Additionally, `app/api/upload/presign/route.ts` omitted `publicUrl` on local fallback responses.
- **Fix**: Implemented `GET` handler in `app/api/upload/file/route.ts` serving from PostgreSQL `upload_objects` or `.local-db/uploads`, and included `publicUrl` on fallback presign responses.

### Defect 8: Node.js Relative URL Crashes in `lib/driver-photo.ts`
- **Root Cause**: Calling `fetch("/api/upload/presign")` and `fetch(uploadUrl)` directly inside Node.js or SSR threw `TypeError: Invalid URL`.
- **Fix**: Added `resolveStorageUrl` helper resolving relative URLs against `APP_URL` / `NEXTAUTH_URL` / `http://localhost:3000`.

---

## 2. Files Modified

| File | Changes Made |
|---|---|
| `lib/notfis-parser.ts` | DANFE key pre-stripping, tokenized number sequence parsing, 3.1 vs 5.0 invoice extraction, multi-invoice 311/319 handling, Brazilian UF regex matching. |
| `app/api/routerizador/parse/route.ts` | Preserved `.csv` files from false NOTFIS classification, implemented dual NOTFIS/spreadsheet fallback. |
| `app/api/upload/presign/route.ts` | Added `publicUrl` to fallback response. |
| `app/api/upload/file/route.ts` | Implemented `GET` handler reading from PostgreSQL DB and filesystem. |
| `lib/driver-photo.ts` | Added `resolveStorageUrl` and included `publicUrl` in `uploadPhotoToStorage` return. |
| `lib/offline.ts` | Added `window.addEventListener("online")` auto-flush listener. |
| `components/roteirizador-page.tsx` | Clarified NOTFIS EDI (.txt / .not / .edi) drag-and-drop support and added `onDragEnter`. |
| `tests/day3-day4-audit.test.mjs` | Added 7 new adversarial test cases covering DANFE collisions, 3.1 blank romaneio, conjoined shipments, CSV/NOTFIS MIME routing, and GET storage retrieval. |

---

## 3. Verification Summary

1. **Automated Test Suites**:
   - `node --test tests/day3-day4-audit.test.mjs`: **18 / 18 passing** (0 failures, 0 skipped).
   - `node --test tests/offline-photo-queue.test.mjs`: **24 / 24 passing** (0 failures, 0 skipped).
   - `node --test tests/e2e-routing.test.mjs`: **47 passing, 0 failures, 10 skipped** (pending milestone M1 `geo-brazil.ts`).
   - Combined repository run (`node --test tests/*.test.mjs`): **89 passing, 0 failures, 10 skipped**.

2. **TypeScript Compilation**:
   - `npx tsc --noEmit`: Exited with code 0 (0 errors).

3. **Next.js Production Build**:
   - `npm run build`: Exited with code 0. Compiled successfully, 11/11 pages generated.
