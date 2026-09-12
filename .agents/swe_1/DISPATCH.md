# Dispatch Log

## 2026-09-12T17:57:14Z

You are the SWE Light Orchestrator for Route_Wise.

Your working directory for metadata (plans, progress, handoffs):
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\swe_1

Project repository directory:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise

Original user request:
C:\Users\Dmeno\Documents\Codex\2026-09-10\canva-plugin-canva-openai-curated-remote\work\Route_Wise\.agents\ORIGINAL_REQUEST.md

Task:
Implement Client-Side Photo Compression and a robust Idempotent Offline Queue for the driver's delivery proof (POD) in the Criar Rota TMS. The goal is to resize heavy camera photos to WebP before network transmission and safely queue them in IndexedDB if the device is offline.

Requirements:
1. R1. Client-Side WebP Compression:
   Update `lib/driver-photo.ts` to intercept the camera image capture. Use `HTMLCanvasElement` or `OffscreenCanvas` to resize the image (max 1600x1200px) and encode it as `image/webp` at 0.70 quality. This must happen before the file touches the fetch API.
2. R2. Idempotent Offline Queue:
   Enhance `lib/offline.ts` to ensure operations queued in IndexedDB `routewise-offline` are stored with an idempotency key (e.g., UUIDv7 or `crypto.randomUUID()`). When the network recovers, `flushQueue` must process payloads reliably exactly once.
3. R3. UI Feedback for Compression & Sync:
   Update the driver app UI (e.g., `components/routewise-app.tsx` inside the camera modal) to display lightweight status indicators (e.g., "Otimizando imagem...", "Salvo offline. Aguardando rede...").

Acceptance Criteria:
- A 5MB+ JPEG file provided to the photo input is successfully compressed to < 350KB WebP before network transmission.
- If the app is offline (simulated by dropping the fetch request), the compressed photo payload is safely stored in `routewise-offline` IndexedDB.
- Reconnecting to the network automatically flushes the queue without duplicating delivery events (idempotent submission).

Follow your SWE Light loop protocol: run teamwork_preview_implementer, then teamwork_preview_reviewer rounds, establishing correctness by running tests rather than mere claims. Maintain progress.md and BRIEFING.md in your working directory. Report back upon completion.
