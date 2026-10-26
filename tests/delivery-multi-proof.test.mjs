import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

describe("Delivery Multi-Proof Endpoint Contract", () => {
  it("allows multiple delivery events for the same stop and removes blocking stop_id idempotency check", () => {
    const routeApiPath = path.join(ROOT_DIR, "app", "api", "[...path]", "route.ts");
    const code = fs.readFileSync(routeApiPath, "utf8");

    // Check that the old blocking check `WHERE operation_id=$1 OR (route_id=$2 AND stop_id=$3)` is NOT present
    const hasOldBlockingCheck = code.includes("WHERE operation_id=$1 OR (route_id=$2 AND stop_id=$3)");
    assert.strictEqual(
      hasOldBlockingCheck,
      false,
      "The endpoint must NOT block subsequent photos on the same stop_id"
    );

    // Check that idempotency is now checked by operation_id
    assert.ok(
      code.includes("WHERE operation_id=$1"),
      "Idempotency must be scoped per operation_id"
    );

    // Check that multiple photos support exists
    assert.ok(
      code.includes("rawPhotos") || code.includes("photos") || code.includes("photoKeys"),
      "The endpoint must handle an array of photos"
    );
  });
});
