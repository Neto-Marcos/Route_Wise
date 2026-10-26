import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

describe("Geocoding High-Performance Resolution", () => {
  it("prioritizes local cache and database before external Nominatim network requests", () => {
    const routeApiPath = path.join(ROOT_DIR, "app", "api", "[...path]", "route.ts");
    const code = fs.readFileSync(routeApiPath, "utf8");

    // Check that memory cache exists
    assert.ok(
      code.includes("geocodeMemoryCache"),
      "Must have geocodeMemoryCache in app/api/[...path]/route.ts"
    );

    // Verify that local DB / cache is checked before external fetch
    const geocodeHandler = code.slice(code.indexOf('if (p[0] === "geocode")'));
    const localDbIndex = geocodeHandler.indexOf("city_geocodes");
    const nominatimIndex = geocodeHandler.indexOf("nominatim.openstreetmap.org");

    assert.ok(localDbIndex !== -1, "Must query city_geocodes");
    assert.ok(nominatimIndex !== -1, "Must have nominatim fallback");
    assert.ok(
      localDbIndex < nominatimIndex,
      "Local database / cache MUST be queried BEFORE external Nominatim network request"
    );

    // Verify auto-persistence to city_geocodes on Nominatim response
    assert.ok(
      geocodeHandler.includes("INSERT INTO city_geocodes"),
      "Must persist new geocodes into city_geocodes"
    );
  });

  it("has responsive client debounce in routewise-app.tsx", () => {
    const appPath = path.join(ROOT_DIR, "components", "routewise-app.tsx");
    const code = fs.readFileSync(appPath, "utf8");

    // Check debounce <= 200ms
    assert.ok(
      code.includes("180") || code.includes("200"),
      "Search debounce must be snappy (180ms - 200ms)"
    );
    assert.strictEqual(
      code.includes("450"),
      false,
      "Old slow 450ms debounce must be eliminated"
    );
  });
});
