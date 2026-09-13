// Robust, Idempotent Offline Queue for Driver Proof of Delivery (POD)
// Stored in IndexedDB "routewise-offline", store "operations"
// Ensures exactly-once processing when connectivity is restored.

const DB = "routewise-offline";
const STORE = "operations";

export interface QueuedOperation<T = any> {
  id: string; // Primary key in IndexedDB and idempotency key
  idempotencyKey: string; // Idempotency key (UUIDv7 or crypto.randomUUID())
  url: string;
  method?: "POST" | "PUT" | "PATCH" | "GET" | "HEAD";
  headers?: Record<string, string>;
  body: T;
  contentType?: string;
  createdAt: string; // ISO 8601 string
  attempts?: number;
  status?: "pending" | "processing" | "failed" | "completed";
  lastError?: string;
}

/**
 * Generates a unique UUID for idempotency.
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getIndexedDB(): IDBFactory | null {
  if (typeof indexedDB !== "undefined") return indexedDB;
  if (typeof window !== "undefined" && window.indexedDB) return window.indexedDB;
  if (typeof globalThis !== "undefined" && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  return null;
}

// Fallback in-memory store for environments without IndexedDB (e.g., SSR or tests)
const memoryStore = new Map<string, QueuedOperation>();

function openDB(): Promise<IDBDatabase> {
  const idb = getIndexedDB();
  if (!idb) {
    throw new Error("IndexedDB não disponível neste ambiente");
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Enqueues an operation into IndexedDB with an idempotency key.
 * Falls back to memoryStore if IndexedDB is unavailable or QuotaExceededError occurs.
 */
export async function enqueue<T = any>(operation: {
  id?: string;
  idempotencyKey?: string;
  url: string;
  method?: "POST" | "PUT" | "PATCH" | "GET" | "HEAD";
  headers?: Record<string, string>;
  body: T;
  contentType?: string;
  createdAt?: string;
}): Promise<QueuedOperation<T>> {
  const key = operation.idempotencyKey || operation.id || generateIdempotencyKey();

  // Propagate idempotency key into payload body
  let body: any = operation.body;
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    !(typeof FormData !== "undefined" && body instanceof FormData) &&
    !(typeof Blob !== "undefined" && body instanceof Blob)
  ) {
    body = { ...(body as Record<string, any>) };
    if (!body.operationId) {
      body.operationId = key;
    }
    if (!body.idempotencyKey) {
      body.idempotencyKey = key;
    }
  } else if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!parsed.operationId) parsed.operationId = key;
        if (!parsed.idempotencyKey) parsed.idempotencyKey = key;
        body = JSON.stringify(parsed);
      }
    } catch {}
  }

  const record: QueuedOperation<T> = {
    id: key,
    idempotencyKey: key,
    url: operation.url,
    method: operation.method || "POST",
    headers: operation.headers || {},
    body: body as T,
    contentType: operation.contentType || "application/json",
    createdAt: operation.createdAt || new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };

  const idb = getIndexedDB();
  if (!idb) {
    memoryStore.set(key, record);
    return record;
  }

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        reject(tx.error);
      };
      tx.onabort = () => {
        try { db.close(); } catch {}
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  } catch (err) {
    console.warn("[offline-queue] IndexedDB indisponível ou cota excedida, armazenando em memória:", err);
    memoryStore.set(key, record);
  }

  // Registra Background Sync para sincronizar assim que a rede voltar
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      if ("sync" in reg) {
        (reg as any).sync.register("rw-background-sync").catch(() => {});
      }
    }).catch(() => {});
  }

  return record;
}

/**
 * Retrieves all items currently waiting in the offline queue (IndexedDB + memory fallback).
 */
export async function getQueueItems(): Promise<QueuedOperation[]> {
  const map = new Map<string, QueuedOperation>();

  // Add memoryStore items first
  for (const [id, op] of memoryStore.entries()) {
    map.set(id, op);
  }

  const idb = getIndexedDB();
  if (idb) {
    try {
      const db = await openDB();
      const idbItems = await new Promise<QueuedOperation[]>((resolve, reject) => {
        const req = db.transaction(STORE).objectStore(STORE).getAll();
        req.onsuccess = () => {
          try { db.close(); } catch {}
          resolve(req.result || []);
        };
        req.onerror = () => {
          try { db.close(); } catch {}
          reject(req.error);
        };
      });
      for (const item of idbItems) {
        map.set(item.id, item);
      }
    } catch (e) {
      console.warn("[offline-queue] Falha ao ler IndexedDB, retornando fila em memória:", e);
    }
  }

  return Array.from(map.values());
}

/**
 * Safely deletes an item from both memory and IndexedDB.
 */
async function deleteQueueRecord(id: string): Promise<void> {
  memoryStore.delete(id);
  const idb = getIndexedDB();
  if (!idb) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        reject(tx.error);
      };
      tx.onabort = () => {
        try { db.close(); } catch {}
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  } catch (e) {
    console.warn("[offline-queue] Falha ao deletar item do IndexedDB:", e);
  }
}

/**
 * Returns the count of pending items in the offline queue.
 */
export async function getQueueCount(): Promise<number> {
  const items = await getQueueItems();
  return items.length;
}

/**
 * Clears all operations from the queue (used for testing or manual purge).
 */
export async function clearQueue(): Promise<void> {
  memoryStore.clear();
  const idb = getIndexedDB();
  if (!idb) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => {
        try { db.close(); } catch {}
        resolve();
      };
      tx.onerror = () => {
        try { db.close(); } catch {}
        reject(tx.error);
      };
      tx.onabort = () => {
        try { db.close(); } catch {}
        reject(tx.error || new Error("Transaction aborted"));
      };
    });
  } catch (e) {
    console.warn("[offline-queue] Falha ao limpar IndexedDB:", e);
  }
}

// In-flight flush mutex to prevent concurrent duplicate flushes
let isFlushing = false;
let currentFlushPromise: Promise<number> | null = null;

/**
 * Flushes the queue reliably exactly once when network recovers.
 * Concurrency-safe: subsequent calls while flushing will await the existing flush.
 * Drains all items including those enqueued during an active flush.
 */
export async function flushQueue(): Promise<number> {
  if (isFlushing && currentFlushPromise) {
    return currentFlushPromise;
  }

  isFlushing = true;
  currentFlushPromise = (async () => {
    try {
      let totalProcessedCount = 0;

      // Drain loop: continue while items exist, in case new items were enqueued while flushing
      let hasError = false;
      while (!hasError) {
        const items = await getQueueItems();
        if (!items.length) break;

        // Process in FIFO order (oldest first)
        items.sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        const role =
          typeof window !== "undefined"
            ? sessionStorage.getItem("rw_role")
            : null;

        let batchProcessed = 0;

        for (const item of items) {
          // If device has dropped offline mid-flush, abort cleanly and keep remaining items
          if (
            typeof navigator !== "undefined" &&
            typeof navigator.onLine === "boolean" &&
            !navigator.onLine
          ) {
            console.warn("[offline-queue] Conexão caiu durante flushQueue, interrompendo sincronização.");
            hasError = true;
            break;
          }

          const method = item.method || "POST";
          const isBodyAllowed = method !== "GET" && method !== "HEAD";

          const headers: Record<string, string> = {
            ...(isBodyAllowed ? { "Content-Type": item.contentType || "application/json" } : {}),
            "Idempotency-Key": item.idempotencyKey || item.id,
            "X-Idempotency-Key": item.idempotencyKey || item.id,
            "X-Operation-Id": item.idempotencyKey || item.id,
            ...(role ? { "X-RouteWise-Role": role } : {}),
            ...(item.headers || {}),
          };

          let body: any = undefined;
          if (isBodyAllowed && item.body !== undefined) {
            body =
              typeof item.body === "string"
                ? item.body
                : JSON.stringify(item.body);
          }

          const rawUrl = item.url;
          const targetUrl =
            typeof window === "undefined" && rawUrl.startsWith("/")
              ? (process.env.APP_URL || "http://localhost:3000") + rawUrl
              : rawUrl;

          let res: Response;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout")), 25000);
          try {
            res = await fetch(targetUrl, {
              method,
              headers,
              ...(isBodyAllowed ? { body } : {}),
              signal: controller.signal,
            });
          } catch (fetchErr) {
            // Network failed mid-request: do NOT delete, break and retry on next reconnect
            console.warn(`[offline-queue] Falha de rede ao enviar operação ${item.id}:`, fetchErr);
            hasError = true;
            break;
          } finally {
            clearTimeout(timeoutId);
          }

          // 2xx Success or 409 Conflict (idempotently already applied on server)
          if (res.ok || res.status === 409) {
            await deleteQueueRecord(item.id);
            batchProcessed++;
            totalProcessedCount++;
          } else if (res.status === 401 || res.status === 403) {
            // Authentication/authorization error: do NOT delete driver proofs!
            // Pause the queue so proofs are not lost, retry when user logs in
            console.warn(`[offline-queue] Autenticação necessária (${res.status}) para ${item.id}. Fila pausada.`);
            hasError = true;
            break;
          } else if (res.status === 429 || res.status >= 500) {
            // 5xx Server Error or 429 Rate Limit: preserve in queue, stop flush, retry later
            console.warn(`[offline-queue] Servidor retornou ${res.status} para ${item.id}. Fila pausada.`);
            hasError = true;
            break;
          } else {
            // Other 4xx permanent client errors (e.g. 400 Bad Request, 404 Not Found, 422)
            console.warn(`[offline-queue] Erro cliente permanente (${res.status}) na operação ${item.id}. Removendo da fila.`);
            await deleteQueueRecord(item.id);
            batchProcessed++;
          }
        }

        // If no items in this batch could be processed or an error halted the batch, stop loop
        if (batchProcessed === 0 || hasError) {
          break;
        }
      }

      if (typeof window !== "undefined" && totalProcessedCount > 0) {
        window.dispatchEvent(
          new CustomEvent("routewise:queue-flushed", {
            detail: { processed: totalProcessedCount },
          }),
        );
      }

      return totalProcessedCount;
    } finally {
      isFlushing = false;
      currentFlushPromise = null;
    }
  })();

  return currentFlushPromise;
}
