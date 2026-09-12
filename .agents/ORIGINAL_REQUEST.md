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
