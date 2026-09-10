const DB = "routewise-offline",
  STORE = "operations";

function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(operation: { id: string; url: string; body: unknown }) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(operation);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushQueue() {
  const db = await open();
  const role = typeof window !== "undefined" ? sessionStorage.getItem("rw_role") : null;
  const items = await new Promise<Array<{ id: string; url: string; body: unknown }>>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  for (const item of items) {
    const res = await fetch(item.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(role ? { "X-RouteWise-Role": role } : {}),
      },
      body: JSON.stringify(item.body),
    });
    if (res.ok) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(item.id);
    }
  }
  return items.length;
}
