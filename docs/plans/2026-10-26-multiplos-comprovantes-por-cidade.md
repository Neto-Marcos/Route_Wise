# Múltiplos Comprovantes por Cidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o motorista envie múltiplas fotos de comprovante para a mesma cidade/parada de uma só vez ou adicione comprovantes extras posteriormente em paradas já entregues.

**Architecture:** 
1. Ajustar o backend em `app/api/[...path]/route.ts` para que a idempotência valide apenas o `operation_id`, aceitando múltiplos `delivery_events` para o mesmo `stop_id`.
2. Expandir o `ProofModal` em `components/routewise-app.tsx` para permitir capturar/anexar uma lista de fotos com galeria de miniaturas e envio em lote.
3. Adicionar o botão `+ Comprovante` no itinerário do motorista para paradas já marcadas como entregues.
4. Atualizar `route-detail-modal.tsx` e `route-report-modal.tsx` para renderizar todas as fotos de cada parada usando `.filter()`.

**Tech Stack:** Next.js 15, React 19, TypeScript, PostgreSQL (pg / pglite), Sharp / Client-side Canvas WebP.

**Spec:** `docs/designs/2026-10-26-multiplos-comprovantes-por-cidade.md`

## Global Constraints
- Nenhuma quebra de retrocompatibilidade com o app mobile offline existente (IndexedDB).
- Todas as imagens continuam sendo comprimidas em WebP no client-side antes do upload.
- Validação estrita de TypeScript (`pnpm typecheck` / `tsc --noEmit`).

## Review Focus
1. Parada já entregue deve aceitar novos comprovantes sem alterar a data da primeira entrega (`delivered_at`).
2. Fila offline deve enfileirar cada foto com seu próprio `operationId` único para evitar colisões.
3. Exclusão de foto antes do envio dentro do modal deve liberar memória (`URL.revokeObjectURL`).
4. Modal de detalhes e romaneio de impressão devem exibir todas as fotos da cidade sem quebrar o layout.
5. Upload direto e pré-assinado (S3/local) devem suportar envios em lote.

---

### Task 1: Backend Delivery Completion & Idempotency Adjustment

**Files:**
- Modify: `app/api/[...path]/route.ts:1070-1135`
- Create: `tests/delivery-multi-proof.test.mjs`

- [ ] **Step 1: Write test for multiple delivery events on the same stop**
  Criar teste em `tests/delivery-multi-proof.test.mjs` simulando duas chamadas consecutivas com `operation_id` diferentes para o mesmo `stop_id` e verificando que ambos os eventos são persistidos.

- [ ] **Step 2: Run test to confirm it fails**
  Executar `node --test tests/delivery-multi-proof.test.mjs` e constatar que a segunda chamada falha ou é ignorada pela cláusula `OR (route_id=$2 AND stop_id=$3)`.

- [ ] **Step 3: Update `app/api/[...path]/route.ts`**
  - Ajustar o check de idempotência para `WHERE operation_id=$1`.
  - Aceitar `photos: Array<{ photoKey, photoBase64, operationId, note }>` além de `photoKey` individual.
  - Para cada foto, gravar um registro em `delivery_events`.
  - Atualizar `route_stops` com `status='delivered'` e `delivered_at=COALESCE(delivered_at, now())`.

- [ ] **Step 4: Run test to confirm it passes**
  Executar `node --test tests/delivery-multi-proof.test.mjs`.

- [ ] **Step 5: Commit changes**
  `git commit -m "feat(api): permitir multiplos eventos de entrega por parada"`

---

### Task 2: Frontend ProofModal Multi-Photo Capture

**Files:**
- Modify: `components/routewise-app.tsx:5546-6050`

- [ ] **Step 1: Update state and helpers in `ProofModal`**
  - Transformar `selectedFile`, `compressedBlob`, `compressedBase64`, `previewUrl` em um array de fotos:
    `photos: Array<{ id: string, file: File, previewUrl: string, blob: Blob, base64: string }>`
  - Criar função para adicionar foto à lista (comprimindo em WebP) e função para remover foto da lista por `id`.

- [ ] **Step 2: Render thumbnails grid and multi-photo controls in `ProofModal`**
  - Exibir miniaturas com botão de exclusão (`×`).
  - Manter botões "Tirar outra foto" e "Escolher da galeria" disponíveis enquanto o modal estiver aberto.
  - Mostrar contador de fotos selecionadas (ex: "3 comprovantes prontos para envio").

- [ ] **Step 3: Update upload and submission logic in `ProofModal`**
  - No `submit`, iterar sobre a lista de fotos, gerando `operationId` único para cada foto.
  - Fazer o upload de cada uma via `/api/uploads/presign` ou `/api/uploads/direct`.
  - Se offline, enfileirar cada comprovante com seu `operationId` no IndexedDB.
  - Chamar `/api/routes/:id/deliveries/:stopId/complete` com as fotos enviadas.

- [ ] **Step 4: Commit changes**
  `git commit -m "feat(mobile): suporte a multiplas fotos no modal de comprovante"`

---

### Task 3: Itinerary "+ Comprovante" Button for Delivered Stops

**Files:**
- Modify: `components/routewise-app.tsx:5400-5540`

- [ ] **Step 1: Render "+ Comprovante" button in delivered stops**
  No itinerário (`showItinerary`), quando `s.status === "delivered"`, adicionar ao lado do badge de entregue o botão:
  `<button type="button" className="button secondary compact" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => { setSelectedDeliveryStop(s); setModal("delivery"); }}>+ Comprovante</button>`.

- [ ] **Step 2: Handle completion of additional proof in `onDone`**
  Garantir que ao salvar um comprovante extra de uma parada já entregue, o modal feche sem reverter o status da parada ou desordenar a lista.

- [ ] **Step 3: Commit changes**
  `git commit -m "feat(mobile): botao de adicionar comprovante em paradas ja entregues"`

---

### Task 4: Multi-Proof Display in Detail Modal & Report

**Files:**
- Modify: `components/route-detail-modal.tsx:560-625`
- Modify: `components/route-report-modal.tsx:200-240`

- [ ] **Step 1: Update `route-detail-modal.tsx`**
  - Substituir `.find((e) => e.stop_id === stop.id)` por `route.delivery_events?.filter((e) => e.stop_id === stop.id) || []`.
  - Renderizar todas as miniaturas dos comprovantes para aquela parada. Se houver mais de uma foto, exibir badge com a quantidade (ex: "2 fotos").

- [ ] **Step 2: Update `route-report-modal.tsx` (Romaneio)**
  - Substituir `.find((e) => e.stop_id === stop.id)` por `.filter((e) => e.stop_id === stop.id)`.
  - Renderizar todos os comprovantes daquela parada no romaneio impresso/PDF.

- [ ] **Step 3: Commit changes**
  `git commit -m "feat(views): exibir todos os comprovantes da parada nos detalhes e romaneio"`

---

### Task 5: Typecheck & Full Validation

- [ ] **Step 1: Run TypeScript compiler check**
  Executar `pnpm typecheck` (ou `npx tsc --noEmit`) e verificar 0 erros.

- [ ] **Step 2: Run test suite**
  Executar `node --test tests/offline-photo-queue.test.mjs` e `node --test tests/delivery-multi-proof.test.mjs`.

- [ ] **Step 3: Verify build**
  Executar `pnpm build` para assegurar que a aplicação Next.js compila perfeitamente para produção.
