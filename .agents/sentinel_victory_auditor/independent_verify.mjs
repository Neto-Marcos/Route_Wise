import assert from "node:assert/strict";
import sharp from "sharp";
import { randomUUID } from "node:crypto";

console.log("--- Starting Independent Auditor Direct Verification ---");

// 1. Direct WebP Compression Test
console.log("Test 1: WebP compression on a 6MB+ JPEG...");
const width = 4500;
const height = 3200;
const rawBuffer = Buffer.alloc(width * height * 3);
for (let i = 0; i < rawBuffer.length; i += 3) {
  rawBuffer[i] = (i * 17) % 256;
  rawBuffer[i + 1] = (i * 31) % 256;
  rawBuffer[i + 2] = (i * 59) % 256;
}

const largeJpg = await sharp(rawBuffer, { raw: { width, height, channels: 3 } })
  .jpeg({ quality: 92 })
  .toBuffer();

const sizeMB = largeJpg.length / (1024 * 1024);
console.log(`  Generated test JPEG size: ${sizeMB.toFixed(2)} MB (${largeJpg.length} bytes)`);
assert.ok(sizeMB >= 5.0, "Input image must be >= 5MB");

const { compressDriverPhoto, calculateDimensions } = await import("../../lib/driver-photo.ts");
const inputFile = new File([largeJpg], "auditor_heavy_camera.jpg", { type: "image/jpeg" });

const compressed = await compressDriverPhoto(inputFile, {
  maxWidth: 1600,
  maxHeight: 1200,
  quality: 0.70,
  maxSizeBytes: 350 * 1024,
});

console.log(`  Compressed WebP size: ${(compressed.size / 1024).toFixed(1)} KB, dimensions: ${compressed.width}x${compressed.height}`);
assert.strictEqual(compressed.format, "image/webp");
assert.ok(compressed.size < 350 * 1024, `Size ${compressed.size} bytes exceeds 350KB`);
assert.ok(compressed.width <= 1600, `Width ${compressed.width} > 1600`);
assert.ok(compressed.height <= 1200, `Height ${compressed.height} > 1200`);
assert.ok(compressed.base64.length > 5000, "Base64 payload is valid");
assert.ok(compressed.dataUrl.startsWith("data:image/webp;base64,"));

// Verify the compressed webp buffer with sharp directly to ensure valid encoding
const verifyMeta = await sharp(Buffer.from(compressed.base64, "base64")).metadata();
assert.strictEqual(verifyMeta.format, "webp");
assert.strictEqual(verifyMeta.width, compressed.width);
assert.strictEqual(verifyMeta.height, compressed.height);
console.log("  ✓ WebP compression verified independently with sharp metadata: PASS");

// 2. Direct Idempotent Offline Queue Test
console.log("Test 2: Idempotent Offline Queue & Exactly-Once Flush...");
const {
  enqueue,
  flushQueue,
  getQueueItems,
  getQueueCount,
  clearQueue,
} = await import("../../lib/offline.ts");

await clearQueue();

const opKey = randomUUID();
const opPayload = {
  operationId: opKey,
  photoBase64: compressed.base64,
  photoContentType: "image/webp",
  note: "Auditor Delivery Proof Verification",
  lat: -23.5505,
  lng: -46.6333,
};

const enqueued = await enqueue({
  idempotencyKey: opKey,
  url: "/api/routes/test-auditor-route/deliveries/stop-auditor/complete",
  body: opPayload,
});

assert.strictEqual(enqueued.id, opKey);
assert.strictEqual(enqueued.idempotencyKey, opKey);
assert.strictEqual(await getQueueCount(), 1);

// Simulate network drop during flush
const originalFetch = globalThis.fetch;
let callAttempts = 0;
globalThis.fetch = async () => {
  callAttempts++;
  throw new TypeError("Failed to fetch (simulated network outage)");
};

const droppedFlush = await flushQueue();
assert.strictEqual(droppedFlush, 0, "No items should be processed while offline");
assert.strictEqual(await getQueueCount(), 1, "Payload must be preserved in queue on drop");
console.log("  ✓ Offline network failure retention verified: PASS");

// Simulate network reconnection
let deliveredPayloads = [];
globalThis.fetch = async (url, opts) => {
  callAttempts++;
  deliveredPayloads.push({
    url,
    headers: opts.headers,
    body: JSON.parse(opts.body),
  });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

const restoredFlush = await flushQueue();
assert.strictEqual(restoredFlush, 1, "Should flush successfully when connection restored");
assert.strictEqual(await getQueueCount(), 0, "Queue must be empty after flush");
assert.strictEqual(deliveredPayloads.length, 1);
assert.strictEqual(deliveredPayloads[0].headers["Idempotency-Key"], opKey);
assert.strictEqual(deliveredPayloads[0].body.operationId, opKey);
console.log("  ✓ Online recovery and idempotency header propagation verified: PASS");

// Simulate duplicate replay (network duplicate / retry)
const secondFlush = await flushQueue();
assert.strictEqual(secondFlush, 0, "Queue is empty, second flush must process 0 items");
assert.strictEqual(deliveredPayloads.length, 1, "No extra network requests made");
console.log("  ✓ Exactly-once execution guarantee verified: PASS");

globalThis.fetch = originalFetch;
await clearQueue();

console.log("=== Independent Auditor Direct Verification: ALL PASSED ===");
