const CACHE = "routewise-v8";
const CORE = ["/", "/offline", "/manifest.json", "/icon.svg", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      // Uma falha isolada de ícone não pode impedir que o app inteiro seja
      // instalado para uso offline.
      .then((c) => Promise.allSettled(CORE.map((url) => c.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // Dados de API são privados por sessão e ficam no snapshot local do app;
  // nunca devem ser compartilhados pelo Cache Storage do navegador.
  if (url.pathname.startsWith("/api/")) return;

  const isAppAsset = ["script", "style", "font", "image"].includes(e.request.destination);
  if (isAppAsset) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const update = fetch(e.request).then((response) => {
          if (response.status === 200) caches.open(CACHE).then((cache) => cache.put(e.request, response.clone()));
          return response;
        }).catch(() => null);
        return cached || update.then((response) => response || caches.match("/offline"));
      }),
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.status === 200) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/").then((root) => root || caches.match("/offline")))),
  );
});

// Web Push: o clique leva o usuário diretamente à operação relacionada.
self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "Criar Rota", {
    body: payload.body || "Há uma atualização operacional.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: payload.url || "/" },
    vibrate: [80, 40, 80],
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
});

// ─── Background Sync ────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "rw-background-sync" || event.tag === "routewise-offline-sync") {
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        if (clientList && clientList.length > 0) {
          for (const client of clientList) {
            client.postMessage({ type: "SYNC_OFFLINE_QUEUE", tag: event.tag });
          }
          return;
        }

        // Fallback: se nenhuma janela estiver aberta, o próprio Service Worker descarrega a fila do IndexedDB
        return flushQueueFromSW();
      })
    );
  }
});

async function flushQueueFromSW() {
  if (typeof indexedDB === "undefined") return;
  return new Promise((resolve) => {
    try {
      const openReq = indexedDB.open("routewise-offline", 1);
      openReq.onerror = () => resolve();
      openReq.onsuccess = () => {
        const db = openReq.result;
        try {
          if (!db.objectStoreNames.contains("operations")) {
            db.close();
            return resolve();
          }
          const tx = db.transaction("operations", "readwrite");
          const store = tx.objectStore("operations");
          const getAllReq = store.getAll();
          getAllReq.onerror = () => {
            try { db.close(); } catch {}
            resolve();
          };
          getAllReq.onsuccess = async () => {
            const items = getAllReq.result || [];
            if (!items.length) {
              try { db.close(); } catch {}
              return resolve();
            }
            items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            for (const item of items) {
              try {
                if (!item.url || typeof item.url !== "string") continue;
                const method = item.method || "POST";
                const isBodyAllowed = method !== "GET" && method !== "HEAD";
                const headers = {
                  ...(isBodyAllowed ? { "Content-Type": item.contentType || "application/json" } : {}),
                  "Idempotency-Key": item.idempotencyKey || item.id,
                  "X-Idempotency-Key": item.idempotencyKey || item.id,
                  "X-Operation-Id": item.idempotencyKey || item.id,
                  ...(item.headers || {}),
                };
                let body = undefined;
                if (isBodyAllowed && item.body !== undefined && item.body !== null) {
                  body = typeof item.body === "string" ? item.body : JSON.stringify(item.body);
                }
                const res = await fetch(item.url, { method, headers, ...(isBodyAllowed ? { body } : {}) });
                if (res.ok || res.status === 409 || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 403 && res.status !== 429)) {
                  const delTx = db.transaction("operations", "readwrite");
                  delTx.objectStore("operations").delete(item.id);
                  await new Promise((r) => { delTx.oncomplete = r; delTx.onerror = r; });
                }
              } catch {
                break; // Conexão interrompida, encerra lote
              }
            }
            try { db.close(); } catch {}
            resolve();
          };
        } catch {
          try { db.close(); } catch {}
          resolve();
        }
      };
    } catch {
      resolve();
    }
  });
}
