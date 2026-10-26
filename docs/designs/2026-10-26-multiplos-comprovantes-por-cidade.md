# Design Doc — Múltiplos Comprovantes de Entrega por Cidade / Parada

**Data:** 26/10/2026  
**Status:** Proposto  
**Sistema:** RouteWise (Criar Rota)  

---

## 1. Contexto e Problema

Quando uma cidade possui mais de um cliente, nota fiscal ou entrega, mas foi cadastrada apenas uma vez como parada na rota, o motorista não conseguia registrar fotos de comprovantes adicionais.

### Causas Identificadas no Código Atual:
1. **Backend (`app/api/[...path]/route.ts`):**  
   A verificação de idempotência em `/api/routes/:id/deliveries/:stopId/complete` executava:
   ```sql
   SELECT operation_id, photo_key FROM delivery_events WHERE operation_id=$1 OR (route_id=$2 AND stop_id=$3)
   ```
   Isso bloqueava silenciosamente qualquer segundo comprovante enviado para a mesma parada (`stop_id`), considerando-o redundante.
2. **Frontend do Motorista (`components/routewise-app.tsx`):**  
   - O componente `ProofModal` só mantinha em memória um único arquivo de foto (`selectedFile`).
   - No itinerário, o botão "Entregar" desaparecia assim que a parada recebia `status = "delivered"`, impedindo novas interações.
3. **Visualização (`route-detail-modal.tsx` e `route-report-modal.tsx`):**  
   Os componentes utilizavam `.find(e => e.stop_id === stop.id)` em vez de `.filter()`, exibindo apenas a primeira foto da cidade.

---

## 2. Solução Proposta

### 2.1 Backend (`app/api/[...path]/route.ts`)
- **Idempotência por Operação:** A verificação passa a ser estritamente `WHERE operation_id=$1`. Cada tentativa de envio de comprovante possui seu próprio UUID (`operationId`), permitindo múltiplos comprovantes válidos para a mesma parada.
- **Suporte a Múltiplos Comprovantes:**
  - O endpoint aceitará ou `photoKey` único (retrocompatibilidade) ou um array `photoKeys: string[]` (e `photos: Array<{ photoKey, photoBase64, operationId }>`).
  - Cada foto gera seu registro em `delivery_events`.
  - A parada (`route_stops`) é atualizada para `status = 'delivered'`, mas chamadas subsequentes continuam aceitas como comprovantes adicionais.

### 2.2 Frontend — Modal de Comprovação (`ProofModal` em `components/routewise-app.tsx`)
- Permitir tirar várias fotos sequenciais sem fechar o modal:
  - Botões para "Tirar outra foto" e "Escolher da galeria".
  - Grade/lista de miniaturas das fotos anexadas com botão de remoção individual.
  - Otimização individual de cada imagem para WebP no cliente.
- Ao clicar em "Confirmar registro":
  - Faz o upload de todas as fotos (ou enfileira no IndexedDB offline se sem rede).
  - Envia os comprovantes e encerra o modal.

### 2.3 Frontend — Acesso Contínuo no Itinerário (`components/routewise-app.tsx`)
- Para paradas já marcadas como `status === "delivered"`, exibir um botão secundário:
  ```tsx
  <button className="button secondary compact" title="Adicionar outro comprovante nesta cidade">
    + Comprovante
  </button>
  ```
- O motorista pode clicar nesse botão a qualquer momento da viagem para adicionar fotos extras de outras notas fiscais ou clientes atendidos naquela mesma cidade.

### 2.4 Visualização & Relatórios
- **`components/route-detail-modal.tsx`:** Usar `filter(e => e.stop_id === stop.id)` e exibir todas as fotos anexadas como miniaturas clicáveis com contador (ex: `2 comprovantes`).
- **`components/route-report-modal.tsx`:** Listar todas as fotos no Romaneio/Prestação de Contas em PDF/Impressão.

---

## 3. Impacto de Dados & Compatibilidade
- **Sem alteração de schema:** A tabela `delivery_events` já comporta múltiplos registros vinculados ao mesmo `stop_id`.
- **Suporte Offline Preservado:** Cada comprovante continuará gerando uma transação idempotente no IndexedDB.
