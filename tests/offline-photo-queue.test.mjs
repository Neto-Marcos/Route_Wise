// Automated Test Suite for:
// 1. Client-Side WebP Compression (R1)
// 2. Idempotent Offline Queue with IndexedDB (R2)
// 3. UI and POD Delivery Proof flow (R3)

import test, { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

// Import modules under test
const { compressDriverPhoto, calculateDimensions, arrayBufferToBase64, getNextStepDown } =
  await import("../lib/driver-photo.ts");

const {
  enqueue,
  flushQueue,
  getQueueItems,
  getQueueCount,
  clearQueue,
  generateIdempotencyKey,
} = await import("../lib/offline.ts");

describe("R1: Client-Side Photo Compression", () => {
  it("calculates aspect-ratio preserving dimensions capped at 1600x1200", () => {
    // Landscape 4:3
    const d1 = calculateDimensions(4000, 3000, 1600, 1200);
    assert.strictEqual(d1.width, 1600);
    assert.strictEqual(d1.height, 1200);

    // 16:9 Landscape
    const d2 = calculateDimensions(3840, 2160, 1600, 1200);
    assert.strictEqual(d2.width, 1600);
    assert.strictEqual(d2.height, 900);

    // Portrait 3:4
    const d3 = calculateDimensions(3000, 4000, 1600, 1200);
    assert.strictEqual(d3.width, 900);
    assert.strictEqual(d3.height, 1200);

    // Small image - does not upscale
    const d4 = calculateDimensions(800, 600, 1600, 1200);
    assert.strictEqual(d4.width, 800);
    assert.strictEqual(d4.height, 600);
  });

  it("calculates dimensions safely with NaN, 0, or negative inputs", () => {
    const d1 = calculateDimensions(NaN, 1200);
    assert.strictEqual(Number.isFinite(d1.width), true);
    assert.ok(d1.width > 0 && d1.width <= 1600);

    const d2 = calculateDimensions(0, 0);
    assert.strictEqual(Number.isFinite(d2.width), true);
    assert.ok(d2.width > 0 && d2.width <= 1600);

    const d3 = calculateDimensions(100, 100, 0, 0);
    assert.strictEqual(Number.isFinite(d3.width), true);
    assert.ok(d3.width > 0);

    const d4 = calculateDimensions(100, 100, NaN, -50);
    assert.strictEqual(Number.isFinite(d4.width), true);
    assert.ok(d4.width > 0);
  });

  it("getNextStepDown guarantees bounded progression and terminates within at most 12 iterations", () => {
    let w = 1600;
    let h = 1200;
    let q = 0.70;
    let iterations = 0;

    while (iterations < 25) {
      const next = getNextStepDown(w, h, q);
      if (!next) break;

      // Prove monotonic decrease
      assert.ok(
        next.nextQ < q || next.nextW < w,
        "Every step must strictly decrease either quality or dimensions",
      );
      assert.ok(next.nextW <= w);
      assert.ok(next.nextH <= h);
      assert.ok(next.nextQ <= q);

      w = next.nextW;
      h = next.nextH;
      q = next.nextQ;
      iterations++;
    }

    assert.ok(
      iterations <= 12,
      `Step-down must terminate in <= 12 steps, took ${iterations}`,
    );
    assert.strictEqual(
      getNextStepDown(w, h, q),
      null,
      "Final state must return null to cleanly break loop",
    );
  });

  it("exercises OffscreenCanvas browser path when available", async () => {
    let convertCount = 0;
    class MockOffscreenCanvas {
      width = 0;
      height = 0;
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return {
          drawImage: () => {},
        };
      }
      async convertToBlob(opts) {
        convertCount++;
        return new Blob([Buffer.from("MOCK_OFFSCREEN_WEBP_DATA")], { type: "image/webp" });
      }
    }

    const origOffscreen = globalThis.OffscreenCanvas;
    const origCreateImageBitmap = globalThis.createImageBitmap;
    try {
      globalThis.OffscreenCanvas = MockOffscreenCanvas;
      let closed = false;
      globalThis.createImageBitmap = async () => ({
        width: 2400,
        height: 1800,
        close: () => { closed = true; },
      });

      const fakeFile = new File([Buffer.from("dummy-raw-image")], "photo.jpg", { type: "image/jpeg" });
      const res = await compressDriverPhoto(fakeFile, { maxWidth: 1600, maxHeight: 1200, quality: 0.70 });
      assert.strictEqual(res.format, "image/webp");
      assert.ok(convertCount >= 1, "Must call convertToBlob");
      assert.strictEqual(closed, true, "Must close bitmap");
      assert.strictEqual(res.width, 1600);
      assert.strictEqual(res.height, 1200);
    } finally {
      if (origOffscreen) globalThis.OffscreenCanvas = origOffscreen;
      else delete globalThis.OffscreenCanvas;
      if (origCreateImageBitmap) globalThis.createImageBitmap = origCreateImageBitmap;
      else delete globalThis.createImageBitmap;
    }
  });

  it("exercises HTMLCanvasElement browser path when available", async () => {
    let toBlobCalls = 0;
    class MockCanvas {
      width = 0;
      height = 0;
      getContext() {
        return {
          drawImage: () => {},
        };
      }
      toBlob(cb, type, quality) {
        toBlobCalls++;
        setTimeout(() => {
          cb(new Blob([Buffer.from("MOCK_CANVAS_BLOB_WEBP")], { type: "image/webp" }));
        }, 0);
      }
      toDataURL() {
        return "data:image/webp;base64," + Buffer.from("MOCK_CANVAS_DATA_URL").toString("base64");
      }
    }

    const origDoc = globalThis.document;
    const origImage = globalThis.Image;
    try {
      globalThis.document = {
        createElement: (tag) => {
          if (tag === "canvas") return new MockCanvas();
          return {};
        },
      };

      class MockImage {
        width = 2000;
        height = 1500;
        onload = null;
        onerror = null;
        set src(_) {
          setTimeout(() => this.onload?.(), 0);
        }
      }
      globalThis.Image = MockImage;

      const fakeFile = new File([Buffer.from("dummy-canvas-file")], "pod.jpg", { type: "image/jpeg" });
      const res = await compressDriverPhoto(fakeFile, { maxWidth: 1600, maxHeight: 1200, quality: 0.70 });
      assert.strictEqual(res.format, "image/webp");
      assert.ok(toBlobCalls >= 1, "Must invoke toBlob on canvas");
      assert.strictEqual(res.width, 1600);
      assert.strictEqual(res.height, 1200);
    } finally {
      if (origDoc) globalThis.document = origDoc;
      else delete globalThis.document;
      if (origImage) globalThis.Image = origImage;
      else delete globalThis.Image;
    }
  });

  it("converts ArrayBuffer to Base64 safely in chunks", () => {
    const raw = Buffer.from("RouteWise_TMS_Proof_Of_Delivery_Offline_Sync");
    const b64 = arrayBufferToBase64(raw);
    assert.strictEqual(b64, raw.toString("base64"));
  });

  it("compresses high-frequency noisy image to strictly < 350KB using adaptive step-down", async () => {
    const crypto = await import("node:crypto");
    const width = 1600;
    const height = 1200;
    const noiseData = crypto.randomBytes(width * height * 3);
    const noiseJpg = await sharp(noiseData, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 90 })
      .toBuffer();

    const file = new File([noiseJpg], "noisy_camera_photo.jpg", { type: "image/jpeg" });
    const result = await compressDriverPhoto(file, { maxWidth: 1600, maxHeight: 1200, quality: 0.70 });
    assert.strictEqual(result.format, "image/webp");
    assert.ok(result.size < 350 * 1024, `Size ${(result.size / 1024).toFixed(1)} KB must be < 350KB`);
    assert.ok(result.width <= 1600 && result.height <= 1200);
  });

  it("Acceptance Criteria 1: Compresses a 5MB+ JPEG to < 350KB WebP before network transmission", async () => {
    // Generate a realistic 5MB+ JPEG camera photo (4000x3000)
    const width = 4000;
    const height = 3000;
    const rawData = Buffer.alloc(width * height * 3);
    for (let i = 0; i < rawData.length; i += 3) {
      rawData[i] = (i * 7) % 256;
      rawData[i + 1] = (i * 13) % 256;
      rawData[i + 2] = (i * 29) % 256;
    }

    const largeJpg = await sharp(rawData, {
      raw: { width, height, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .toBuffer();

    const originalSizeBytes = largeJpg.length;
    const originalSizeMB = originalSizeBytes / (1024 * 1024);
    assert.ok(
      originalSizeMB >= 5.0,
      `Original image must be >= 5MB, got ${originalSizeMB.toFixed(2)} MB`,
    );

    const file = new File([largeJpg], "camera_pod_capture.jpg", {
      type: "image/jpeg",
    });

    const start = performance.now();
    const result = await compressDriverPhoto(file, {
      maxWidth: 1600,
      maxHeight: 1200,
      quality: 0.7,
      maxSizeBytes: 350 * 1024,
    });
    const elapsed = performance.now() - start;

    // 1. Must be WebP format
    assert.strictEqual(
      result.format,
      "image/webp",
      "Result format must be image/webp",
    );
    assert.ok(
      result.dataUrl.startsWith("data:image/webp;base64,"),
      "Data URL must start with data:image/webp;base64,",
    );

    // 2. Must resize to max 1600x1200px
    assert.ok(
      result.width <= 1600,
      `Width ${result.width} exceeds max width 1600`,
    );
    assert.ok(
      result.height <= 1200,
      `Height ${result.height} exceeds max height 1200`,
    );

    // 3. Must be strictly < 350KB
    const compressedKB = result.size / 1024;
    assert.ok(
      result.size < 350 * 1024,
      `Result size ${compressedKB.toFixed(1)} KB exceeds 350 KB threshold`,
    );

    // 4. Base64 payload must be valid and non-empty
    assert.ok(
      result.base64.length > 1000,
      "Base64 output must be substantial valid data",
    );

    console.log(
      `   [R1 PASS] 5MB+ JPEG (${originalSizeMB.toFixed(2)} MB) -> WebP (${compressedKB.toFixed(1)} KB, ${result.width}x${result.height}px) in ${elapsed.toFixed(0)}ms`,
    );
  });
});

describe("R2: Idempotent Offline Queue", () => {
  before(async () => {
    await clearQueue();
  });

  after(async () => {
    await clearQueue();
  });

  it("generates valid UUIDv4 idempotency keys", () => {
    const key1 = generateIdempotencyKey();
    const key2 = generateIdempotencyKey();
    assert.notStrictEqual(key1, key2);
    assert.match(
      key1,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("Acceptance Criteria 2: Enqueues operations with idempotency keys and propagates operationId to body", async () => {
    await clearQueue();

    const photoPayload = {
      lat: -23.5615,
      lng: -46.656,
      note: "Entregue em mãos",
      photoBase64: "UklGRjIAAABXRUJQVlA4ICYAAAAyAAAA...",
      photoContentType: "image/webp",
    };

    const queued = await enqueue({
      url: "/api/routes/test-route-1/deliveries/stop-1/complete",
      body: photoPayload,
    });

    assert.ok(queued.id, "Queue record must have an id");
    assert.strictEqual(
      queued.id,
      queued.idempotencyKey,
      "id must match idempotencyKey",
    );
    assert.strictEqual(
      queued.body.operationId,
      queued.idempotencyKey,
      "Payload body must receive operationId matching idempotencyKey",
    );

    const count = await getQueueCount();
    assert.strictEqual(count, 1);

    const items = await getQueueItems();
    assert.strictEqual(items[0].id, queued.id);
    assert.strictEqual(items[0].body.photoContentType, "image/webp");
  });

  it("Acceptance Criteria 3: flushQueue flushes items with idempotency headers and deletes upon success", async () => {
    await clearQueue();

    // Enqueue two operations
    const op1 = await enqueue({
      url: "/api/routes/route-123/deliveries/stop-1/complete",
      body: { note: "Delivery 1", photoBase64: "WEBP_DATA_1" },
    });

    const op2 = await enqueue({
      url: "/api/routes/route-123/deliveries/stop-2/complete",
      body: { note: "Delivery 2", photoBase64: "WEBP_DATA_2" },
    });

    assert.strictEqual(await getQueueCount(), 2);

    // Mock global fetch to verify idempotency headers
    const sentRequests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      sentRequests.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      const flushedCount = await flushQueue();
      assert.strictEqual(flushedCount, 2, "Must flush exactly 2 operations");

      // Verify requests were sent with Idempotency-Key headers
      assert.strictEqual(sentRequests.length, 2);
      assert.strictEqual(
        sentRequests[0].options.headers["Idempotency-Key"],
        op1.idempotencyKey,
      );
      assert.strictEqual(
        sentRequests[0].options.headers["X-Operation-Id"],
        op1.idempotencyKey,
      );
      assert.strictEqual(
        sentRequests[1].options.headers["Idempotency-Key"],
        op2.idempotencyKey,
      );

      // Verify queue is now empty
      const remainingCount = await getQueueCount();
      assert.strictEqual(
        remainingCount,
        0,
        "Queue must be empty after successful flush",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Acceptance Criteria 3: Concurrency protection ensures flushQueue runs exactly once when called in parallel", async () => {
    await clearQueue();

    await enqueue({
      url: "/api/routes/route-123/deliveries/stop-3/complete",
      body: { note: "Parallel test", photoBase64: "WEBP_DATA_3" },
    });

    let networkCallCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      networkCallCount++;
      // Artificial delay to test concurrency race condition
      await new Promise((r) => setTimeout(r, 40));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      // Call flushQueue multiple times concurrently
      const [res1, res2, res3] = await Promise.all([
        flushQueue(),
        flushQueue(),
        flushQueue(),
      ]);

      assert.strictEqual(
        networkCallCount,
        1,
        "Network request must execute exactly once even when flushQueue is invoked concurrently",
      );
      assert.strictEqual(
        await getQueueCount(),
        0,
        "Queue should be completely processed",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Acceptance Criteria 2: Retains payload safely in queue when fetch fails (simulated offline network drop)", async () => {
    await clearQueue();

    const offlineOp = await enqueue({
      url: "/api/routes/route-123/deliveries/stop-offline/complete",
      body: {
        note: "Offline Delivery",
        photoBase64: "SAVED_OFFLINE_WEBP_DATA",
      },
    });

    const originalFetch = globalThis.fetch;
    // Simulate network drop
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch: Network is offline");
    };

    try {
      const flushedCount = await flushQueue();
      assert.strictEqual(flushedCount, 0, "No items processed while offline");

      // Verify item is safely preserved in queue!
      const count = await getQueueCount();
      assert.strictEqual(
        count,
        1,
        "Payload must remain safely in offline queue during network failure",
      );
      const items = await getQueueItems();
      assert.strictEqual(items[0].id, offlineOp.id);
      assert.strictEqual(
        items[0].body.photoBase64,
        "SAVED_OFFLINE_WEBP_DATA",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Now simulate network recovery
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const recoveredCount = await flushQueue();
      assert.strictEqual(
        recoveredCount,
        1,
        "Should flush successfully when connection recovers",
      );
      assert.strictEqual(await getQueueCount(), 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to memoryStore when IndexedDB throws QuotaExceededError and flushes safely", async () => {
    await clearQueue();

    const mockFailingDB = {
      name: "routewise-offline",
      objectStoreNames: { contains: () => true },
      transaction: () => {
        const tx = {
          objectStore: () => ({
            put: () => {
              const err = new Error("The quota has been exceeded.");
              err.name = "QuotaExceededError";
              throw err;
            },
            getAll: () => {
              const req = { result: [] };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            delete: () => {},
            clear: () => {},
          }),
          oncomplete: null,
          onerror: null,
        };
        setTimeout(() => tx.oncomplete?.(), 0);
        return tx;
      },
    };

    const mockIDB = {
      open: () => {
        const req = {
          result: mockFailingDB,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      },
    };

    globalThis.indexedDB = mockIDB;
    try {
      const record = await enqueue({
        url: "/api/routes/route-quota/deliveries/stop-quota/complete",
        body: { note: "Quota fallback delivery", photoBase64: "QUOTA_BASE64" },
      });
      assert.ok(record.id);

      const items = await getQueueItems();
      assert.ok(items.some((i) => i.id === record.id));

      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
      try {
        const flushed = await flushQueue();
        assert.ok(flushed >= 1);
      } finally {
        globalThis.fetch = origFetch;
      }
    } finally {
      delete globalThis.indexedDB;
      await clearQueue();
    }
  });

  it("retains queue items when server responds with 401 Unauthorized or 403 Forbidden (preserves driver work)", async () => {
    await clearQueue();

    const authOp = await enqueue({
      url: "/api/routes/route-auth/deliveries/stop-auth/complete",
      body: { note: "Auth test", photoBase64: "AUTH_WEBP_DATA" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Sessão expirada" }), { status: 401 });

    try {
      const flushed = await flushQueue();
      assert.strictEqual(flushed, 0, "No items processed on 401");

      const count = await getQueueCount();
      assert.strictEqual(count, 1, "Proof must NOT be deleted on 401 session expiration");

      const items = await getQueueItems();
      assert.strictEqual(items[0].id, authOp.id);
    } finally {
      globalThis.fetch = origFetch;
      await clearQueue();
    }
  });

  it("drains items enqueued concurrently while a flush is in-flight", async () => {
    await clearQueue();

    await enqueue({
      url: "/api/routes/route-drain/deliveries/stop-1/complete",
      body: { note: "First", photoBase64: "DATA1" },
    });

    const origFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount++;
      if (requestCount === 1) {
        // While first request is in-flight, enqueue a second operation
        await enqueue({
          url: "/api/routes/route-drain/deliveries/stop-2/complete",
          body: { note: "Second enqueued during flush", photoBase64: "DATA2" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const flushed = await flushQueue();
      assert.strictEqual(flushed, 2, "Must flush both the initial item and the concurrently enqueued item");
      assert.strictEqual(await getQueueCount(), 0, "Queue must be completely drained");
    } finally {
      globalThis.fetch = origFetch;
      await clearQueue();
    }
  });

  it("handles request abort / timeout gracefully and retains payload in queue", async () => {
    await clearQueue();

    await enqueue({
      url: "/api/routes/route-timeout/deliveries/stop-t/complete",
      body: { note: "Timeout test", photoBase64: "DATA_T" },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "AbortError";
      throw err;
    };

    try {
      const flushed = await flushQueue();
      assert.strictEqual(flushed, 0);
      assert.strictEqual(await getQueueCount(), 1, "Item must remain in queue after timeout abort");
    } finally {
      globalThis.fetch = origFetch;
      await clearQueue();
    }
  });

  it("flushes queue with method: GET without passing body and without TypeError", async () => {
    await clearQueue();

    await enqueue({
      url: "/api/routes/route-get-test/status",
      method: "GET",
      body: { extra: "should not be in fetch body" },
    });

    let interceptedOptions = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      interceptedOptions = options;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const flushed = await flushQueue();
      assert.strictEqual(flushed, 1);
      assert.strictEqual(interceptedOptions?.body, undefined, "GET request must never have a body");
      assert.strictEqual(interceptedOptions?.method, "GET");
      assert.strictEqual(await getQueueCount(), 0);
    } finally {
      globalThis.fetch = origFetch;
      await clearQueue();
    }
  });

  it("stops drain loop immediately on network drop without retrying subsequent items in the batch", async () => {
    await clearQueue();

    // Enqueue 2 operations
    await enqueue({
      url: "/api/routes/drain-error/1",
      body: { id: 1 },
    });
    await enqueue({
      url: "/api/routes/drain-error/2",
      body: { id: 2 },
    });

    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      // Second request fails due to network drop
      throw new TypeError("Failed to fetch: Network lost");
    };

    try {
      const flushed = await flushQueue();
      assert.strictEqual(flushed, 1, "First item succeeded");
      assert.strictEqual(
        fetchCount,
        2,
        "Must halt flush immediately on network error without spurious immediate retry",
      );
      assert.strictEqual(await getQueueCount(), 1, "Item 2 safely retained in queue");
    } finally {
      globalThis.fetch = origFetch;
      await clearQueue();
    }
  });
});

describe("R3: UI Status Indicators & Contract Verification", () => {
  it("Verifies UI indicator string contracts are present in components/routewise-app.tsx", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      new URL("../components/routewise-app.tsx", import.meta.url),
      "utf-8",
    );

    // Indicator 1: "Otimizando imagem..."
    assert.ok(
      code.includes("Otimizando imagem..."),
      "Must include lightweight status indicator 'Otimizando imagem...'",
    );

    // Indicator 2: "Salvo offline. Aguardando rede..."
    assert.ok(
      code.includes("Salvo offline. Aguardando rede..."),
      "Must include lightweight status indicator 'Salvo offline. Aguardando rede...'",
    );

    // R1: compressDriverPhoto must be called in ProofModal
    assert.ok(
      code.includes("compressDriverPhoto(file"),
      "ProofModal must invoke compressDriverPhoto before transmission",
    );

    // R2: enqueue must be called in ProofModal
    assert.ok(
      code.includes("enqueue({"),
      "ProofModal must queue delivery payloads into offline queue",
    );

    // R3: Submit must guard against submitting while compressing
    assert.ok(
      code.includes("if (compressing) return;"),
      "ProofModal submit handler must guard against premature submission during compression",
    );

    // R1: Must import arrayBufferToBase64 as robust fallback
    assert.ok(
      code.includes("arrayBufferToBase64"),
      "Must import arrayBufferToBase64 for safe payload fallback",
    );

    // R3: Must include optimistic state updates for start, delivery, and finish
    assert.ok(
      code.includes('status: "active"'),
      "Must optimistically set status to active on start",
    );
    assert.ok(
      code.includes('status: "delivered"'),
      "Must optimistically set stop status to delivered on delivery",
    );
    assert.ok(
      code.includes('status: "completed"'),
      "Must optimistically set status to completed on finish",
    );
  });
});

describe("R2: IndexedDB Engine Integration", () => {
  it("interacts directly with IndexedDB IDBDatabase transactions and stores", async () => {
    let closedCount = 0;
    const storeMap = new Map();
    const mockDB = {
      name: "routewise-offline",
      objectStoreNames: { contains: (n) => n === "operations" },
      createObjectStore: (name) => ({}),
      close: () => {
        closedCount++;
      },
      transaction: (name, mode) => {
        const tx = {
          objectStore: () => ({
            put: (val) => {
              storeMap.set(val.id, val);
            },
            getAll: () => {
              const req = { result: Array.from(storeMap.values()) };
              setTimeout(() => req.onsuccess?.(), 0);
              return req;
            },
            delete: (id) => {
              storeMap.delete(id);
            },
            clear: () => {
              storeMap.clear();
            },
          }),
          oncomplete: null,
          onerror: null,
        };
        setTimeout(() => tx.oncomplete?.(), 0);
        return tx;
      },
    };

    const mockIDB = {
      open: (dbName, version) => {
        const req = {
          result: mockDB,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        setTimeout(() => {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        }, 0);
        return req;
      },
    };

    globalThis.indexedDB = mockIDB;
    try {
      await clearQueue();
      const op = await enqueue({
        url: "/api/routes/idb-route-1/deliveries/stop-idb/complete",
        body: { note: "IDB delivery POD", photoBase64: "IDB_PAYLOAD_WEBP" },
      });

      assert.ok(op.id);
      assert.strictEqual(storeMap.size, 1);
      assert.strictEqual(storeMap.get(op.id).idempotencyKey, op.id);

      const count = await getQueueCount();
      assert.strictEqual(count, 1);

      const items = await getQueueItems();
      assert.strictEqual(items[0].body.photoBase64, "IDB_PAYLOAD_WEBP");

      // Flush queue
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 });
      try {
        const flushed = await flushQueue();
        assert.strictEqual(flushed, 1);
        assert.strictEqual(storeMap.size, 0);
      } finally {
        globalThis.fetch = origFetch;
      }

      assert.ok(closedCount > 0, "Must close IDBDatabase connections to prevent memory/handle leaks");
    } finally {
      delete globalThis.indexedDB;
    }
  });

  it("OffscreenCanvas cleans up ImageBitmap in finally block even when convertToBlob throws", async () => {
    let closed = false;
    class FailingOffscreenCanvas {
      width = 0;
      height = 0;
      constructor(w, h) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return { drawImage: () => {} };
      }
      async convertToBlob() {
        throw new Error("Simulated convertToBlob failure");
      }
    }

    const origOffscreen = globalThis.OffscreenCanvas;
    const origCreateImageBitmap = globalThis.createImageBitmap;
    try {
      globalThis.OffscreenCanvas = FailingOffscreenCanvas;
      globalThis.createImageBitmap = async () => ({
        width: 1000,
        height: 800,
        close: () => { closed = true; },
      });

      const fakeFile = new File([Buffer.from("dummy-cleanup-test")], "test.jpg", { type: "image/jpeg" });
      try {
        await compressDriverPhoto(fakeFile);
      } catch {}

      assert.strictEqual(closed, true, "ImageBitmap must be closed even if OffscreenCanvas fails");
    } finally {
      if (origOffscreen) globalThis.OffscreenCanvas = origOffscreen;
      else delete globalThis.OffscreenCanvas;
      if (origCreateImageBitmap) globalThis.createImageBitmap = origCreateImageBitmap;
      else delete globalThis.createImageBitmap;
    }
  });

  it("flushQueue resolves relative URLs with base URL in Node.js environment", async () => {
    await clearQueue();
    const op = await enqueue({
      url: "/api/routes/relative-url-test/complete",
      body: { test: true },
    });

    let requestedUrl = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const flushed = await flushQueue();
      assert.strictEqual(flushed, 1);
      assert.ok(requestedUrl.startsWith("http://localhost:3000/api/routes/relative-url-test/complete") || requestedUrl.startsWith("http"), `Expected full absolute URL, got ${requestedUrl}`);
    } finally {
      globalThis.fetch = origFetch;
      await clearQueue();
    }
  });

  it("ProofModal contains double-submit lock, explicit role header, and pass-through onDone", async () => {
    const fs = await import("node:fs/promises");
    const code = await fs.readFile(
      new URL("../components/routewise-app.tsx", import.meta.url),
      "utf-8",
    );

    assert.ok(
      code.includes("isSubmittingRef"),
      "Must include isSubmittingRef to lock against rapid double submissions",
    );
    assert.ok(
      code.includes('"X-RouteWise-Role": "driver"'),
      "Must explicitly pass X-RouteWise-Role: driver in ProofModal offline enqueue",
    );
    assert.ok(
      code.includes("onDone(phase, stop)"),
      "Must pass phase and stop to onDone callback to eliminate closure race conditions",
    );
  });
});

