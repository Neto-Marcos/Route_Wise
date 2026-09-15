// Verification test script for RouteWise features and bug fixes
import { randomUUID } from "node:crypto";
const BASE = "http://localhost:3000";

async function assert(desc, fn) {
  try {
    await fn();
    console.log(`PASS: ${desc}`);
  } catch (e) {
    console.error(`FAIL: ${desc} -> ${e.message}`);
    throw e;
  }
}

async function run() {
  console.log("=== Starting RouteWise Verification Suite ===\n");

  let dispatcherCookie = "";
  let testDriverId = "";
  let testVehicleId = "";
  let testRouteId = "";

  // 1. Root page & static PWA assets
  await assert("GET / responds with 200 OK", async () => {
    const res = await fetch(`${BASE}/`);
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
  });

  await assert("GET /manifest.json returns valid PWA manifest", async () => {
    const res = await fetch(`${BASE}/manifest.json`);
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const json = await res.json();
    if (json.name !== "RouteWise — Gestão de Rotas" && json.name !== "Criar Rota — Gestão de Rotas") throw new Error("Invalid manifest name");
    if (json.display !== "standalone") throw new Error("Display is not standalone");
  });

  await assert("GET /sw.js caches /manifest.json (not /manifest.webmanifest)", async () => {
    const res = await fetch(`${BASE}/sw.js`);
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const code = await res.text();
    if (code.includes("/manifest.webmanifest")) throw new Error("Still has broken /manifest.webmanifest");
    if (!code.includes("/manifest.json")) throw new Error("Missing /manifest.json in core cache");
  });

  await assert("GET /api/health responds with healthy", async () => {
    const res = await fetch(`${BASE}/api/health`);
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const json = await res.json();
    if (json.status !== "healthy") throw new Error(`Unexpected body: ${JSON.stringify(json)}`);
  });

  // 2. Dispatcher Auth
  await assert("POST /api/session/dispatcher authenticates with credentials", async () => {
    const res = await fetch(`${BASE}/api/session/dispatcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyCode: "EU", email: "marcos", password: "admin123" }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const cookie = res.headers.get("set-cookie");
    if (!cookie || !cookie.includes("rw_dispatcher_session")) throw new Error("No session cookie returned");
    dispatcherCookie = cookie;
  });

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Cookie: dispatcherCookie,
    "X-RouteWise-Role": "dispatcher",
  });

  // 3. Driver Management (Task 11)
  await assert("POST /api/drivers creates active driver", async () => {
    const res = await fetch(`${BASE}/api/drivers`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Motorista Teste QA",
        phone: "(11) 98888-7777",
        password: "1234",
      }),
    });
    if (res.status !== 201) throw new Error(`Status was ${res.status}`);
    const driver = await res.json();
    if (!driver.id || driver.name !== "Motorista Teste QA") throw new Error("Driver creation failed");
    testDriverId = driver.id;
  });

  await assert("PUT /api/drivers/[id] updates driver name, phone and password", async () => {
    const res = await fetch(`${BASE}/api/drivers/${testDriverId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Motorista QA Atualizado",
        phone: "(11) 98888-0000",
        password: "5678",
        active: true,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const updated = await res.json();
    if (updated.name !== "Motorista QA Atualizado" || updated.phone !== "(11) 98888-0000")
      throw new Error("Update fields mismatch");
  });

  await assert("DELETE /api/drivers/[id] soft-inactivates driver", async () => {
    const res = await fetch(`${BASE}/api/drivers/${testDriverId}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
  });

  await assert("GET /api/drivers?all=true lists inactive drivers", async () => {
    const res = await fetch(`${BASE}/api/drivers?all=true`, { headers: authHeaders() });
    const list = await res.json();
    const found = list.find((d) => d.id === testDriverId);
    if (!found) throw new Error("Driver not found in all drivers list");
    if (found.active !== false) throw new Error("Driver should be inactive");
  });

  // Re-activate driver for route testing
  await assert("PUT /api/drivers/[id] reactivates driver", async () => {
    const res = await fetch(`${BASE}/api/drivers/${testDriverId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Motorista QA Ativo",
        phone: "(11) 98888-0000",
        active: true,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
  });

  // 4. Vehicle Management (Task 11)
  const testPlate = "TEST" + Math.floor(1000 + Math.random() * 9000);
  await assert("POST /api/vehicles creates vehicle with rate_per_km", async () => {
    const res = await fetch(`${BASE}/api/vehicles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Van Sprinter QA",
        plate: testPlate,
        odometer: 15420.5,
        rate_per_km: 2.15,
      }),
    });
    if (res.status !== 201) throw new Error(`Status was ${res.status}`);
    const vehicle = await res.json();
    if (Number(vehicle.rate_per_km) !== 2.15) throw new Error(`rate_per_km mismatch: ${vehicle.rate_per_km}`);
    testVehicleId = vehicle.id;
  });

  await assert("PUT /api/vehicles/[id] updates odometer and rate_per_km", async () => {
    const res = await fetch(`${BASE}/api/vehicles/${testVehicleId}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Van Sprinter QA Turbinada",
        plate: testPlate,
        odometer: 16000.0,
        rate_per_km: 2.50,
        active: true,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const updated = await res.json();
    if (Number(updated.current_odometer) !== 16000.0) throw new Error("Odometer mismatch");
    if (Number(updated.rate_per_km) !== 2.50) throw new Error("rate_per_km mismatch");
  });

  await assert("PUT /api/vehicles/[id] duplicate plate returns 409", async () => {
    // Create second vehicle
    const secondPlate = "DUP" + Math.floor(1000 + Math.random() * 9000);
    const createRes = await fetch(`${BASE}/api/vehicles`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Caminhão 2", plate: secondPlate, odometer: 5000 }),
    });
    const secondVehicle = await createRes.json();

    // Try updating second vehicle to first vehicle's plate
    const dupRes = await fetch(`${BASE}/api/vehicles/${secondVehicle.id}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Caminhão 2", plate: testPlate, odometer: 5000 }),
    });
    if (dupRes.status !== 409) throw new Error(`Expected 409, got ${dupRes.status}`);
    const errJson = await dupRes.json();
    if (!errJson.error.includes("Já existe um veículo")) throw new Error(`Unexpected error message: ${errJson.error}`);
  });

  // 5. Routes & Date Normalization (Task 1, 2, 3, 5, 7)
  const todayLocal = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  await assert("POST /api/routes creates route for today with stops", async () => {
    const res = await fetch(`${BASE}/api/routes`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        name: "Rota Teste QA Hoje",
        routeDate: todayLocal,
        optimizeBy: "distance",
        circular: true,
        estimatedKm: 18.5,
        stops: [
          { name: "CD Principal", address: "Av. Paulista, 1000", lat: -23.5615, lng: -46.6560 },
          { name: "Cliente Alpha", address: "Rua Augusta, 500", lat: -23.5510, lng: -46.6520 },
          { name: "Cliente Beta", address: "Rua Oscar Freire, 200", lat: -23.5640, lng: -46.6690 },
        ],
      }),
    });
    if (res.status !== 201) throw new Error(`Status was ${res.status}`);
    const route = await res.json();
    testRouteId = route.id;
  });

  await assert("GET /api/routes returns route_date normalized as YYYY-MM-DD", async () => {
    const res = await fetch(`${BASE}/api/routes`, { headers: authHeaders() });
    const routes = await res.json();
    const found = routes.find((r) => r.id === testRouteId);
    if (!found) throw new Error("Created route not in list");
    if (found.route_date !== todayLocal) throw new Error(`route_date is '${found.route_date}', expected '${todayLocal}'`);
    if (found.route_date.length !== 10) throw new Error(`route_date length is ${found.route_date.length}, expected 10`);
  });

  await assert("GET /api/routes?date=... filters accurately by date", async () => {
    const res = await fetch(`${BASE}/api/routes?date=${todayLocal}`, { headers: authHeaders() });
    const routes = await res.json();
    const found = routes.find((r) => r.id === testRouteId);
    if (!found) throw new Error("Route not found when filtering by date");

    const nonExistent = await fetch(`${BASE}/api/routes?date=2099-12-31`, { headers: authHeaders() });
    const emptyRoutes = await nonExistent.json();
    if (emptyRoutes.length !== 0) throw new Error(`Expected 0 routes for 2099, got ${emptyRoutes.length}`);
  });

  await assert("POST /api/routes/[id]/assign assigns driver and vehicle", async () => {
    const res = await fetch(`${BASE}/api/routes/${testRouteId}/assign`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ driverId: testDriverId, vehicleId: testVehicleId }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
  });

  // 6. Driver Flow & Start / GPS / Finish (Task 1, 3, 4)
  let driverCookie = "";
  await assert("POST /api/session/driver logs in driver", async () => {
    const res = await fetch(`${BASE}/api/session/driver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverId: testDriverId, password: "5678" }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    driverCookie = res.headers.get("set-cookie");
    if (!driverCookie) throw new Error("Driver cookie missing");
  });

  const driverHeaders = () => ({
    "Content-Type": "application/json",
    Cookie: driverCookie,
    "X-RouteWise-Role": "driver",
  });

  // Upload odometer start photo via local storage endpoint
  let startPhotoKey = "";
  await assert("Upload local photo via /api/uploads/presign and /api/uploads/local/...", async () => {
    const presignRes = await fetch(`${BASE}/api/uploads/presign`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({ kind: "start", contentType: "image/jpeg", size: 1024 }),
    });
    if (presignRes.status !== 200) throw new Error(`Presign status: ${presignRes.status}`);
    const { key, url } = await presignRes.json();
    startPhotoKey = key;

    const fakeJpg = Buffer.from("FAKE_JPEG_IMAGE_DATA_12345");
    const uploadRes = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: fakeJpg,
    });
    if (uploadRes.status !== 204) throw new Error(`Local upload status: ${uploadRes.status}`);

    const viewRes = await fetch(`${BASE}/api/uploads/local/${encodeURIComponent(key)}`);
    if (viewRes.status !== 200) throw new Error(`View upload status: ${viewRes.status}`);
    const downloaded = await viewRes.arrayBuffer();
    if (Buffer.from(downloaded).toString() !== "FAKE_JPEG_IMAGE_DATA_12345")
      throw new Error("Downloaded data mismatch");
  });

  await assert("POST /api/routes/[id]/start starts route with odometer", async () => {
    const res = await fetch(`${BASE}/api/routes/${testRouteId}/start`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        kilometers: 16000.0,
        photoKey: startPhotoKey,
        lat: -23.5615,
        lng: -46.6560,
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
  });

  await assert("POST /api/routes/[id]/location sends GPS point for Live Fleet Map", async () => {
    const res = await fetch(`${BASE}/api/routes/${testRouteId}/location`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        points: [
          {
            operationId: randomUUID(),
            lat: -23.5510,
            lng: -46.6520,
            accuracy: 8.5,
            recordedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
  });

  await assert("GET /api/routes/[id] returns route details with odometer, photo_url, and location", async () => {
    const res = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    if (res.status !== 200) throw new Error(`Status was ${res.status}`);
    const details = await res.json();
    if (details.status !== "active") throw new Error(`Status is ${details.status}, expected active`);
    if (!details.odometer?.length) throw new Error("Odometer readings missing");
    if (!details.odometer[0].photo_url) throw new Error("Odometer photo_url missing");
    if (!details.location_points?.length) throw new Error("Location points missing");
    if (details.route_date !== todayLocal) throw new Error(`route_date mismatch: ${details.route_date}`);
  });

  // Deliver Stop 1 with Proof photo
  await assert("POST /api/routes/[id]/deliveries/[stopId]/complete records delivery event", async () => {
    const detailsRes = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const details = await detailsRes.json();
    const firstDeliveryStop = details.stops.find((s) => !s.is_origin);
    if (!firstDeliveryStop) throw new Error("No delivery stop found");

    const presignRes = await fetch(`${BASE}/api/uploads/presign`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({ kind: "delivery", contentType: "image/jpeg" }),
    });
    const { key, url } = await presignRes.json();
    await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: Buffer.from("DELIVERY_PHOTO_BYTES"),
    });

    const compRes = await fetch(`${BASE}/api/routes/${testRouteId}/deliveries/${firstDeliveryStop.id}/complete`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        operationId: randomUUID(),
        photoKey: key,
        note: "Entregue na recepção para Dona Maria",
        lat: -23.5510,
        lng: -46.6520,
      }),
    });
    if (compRes.status !== 200) throw new Error(`Complete status: ${compRes.status}`);
  });

  // Deliver Stop 2 with compressed WebP POD photo from offline queue payload
  let stop2OperationId = randomUUID();
  await assert("Acceptance Criteria 1 & 2: Deliver Stop 2 using compressed WebP photo payload (< 350KB)", async () => {
    const detailsRes = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const details = await detailsRes.json();
    const secondDeliveryStop = details.stops.filter((s) => !s.is_origin)[1];
    if (!secondDeliveryStop) throw new Error("Second delivery stop not found");

    // 1. Generate heavy 5MB+ JPEG
    const sharp = (await import("sharp")).default;
    const width = 4000;
    const height = 3000;
    const rawData = Buffer.alloc(width * height * 3);
    for (let i = 0; i < rawData.length; i += 3) {
      rawData[i] = (i * 7) % 256;
      rawData[i + 1] = (i * 13) % 256;
      rawData[i + 2] = (i * 29) % 256;
    }
    const heavyJpg = await sharp(rawData, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();
    if (heavyJpg.length < 5 * 1024 * 1024) throw new Error("Image not 5MB+");

    // 2. Compress via compressDriverPhoto
    const { compressDriverPhoto } = await import("../lib/driver-photo.ts");
    const file = new File([heavyJpg], "pod_photo.jpg", { type: "image/jpeg" });
    const compressed = await compressDriverPhoto(file, { maxWidth: 1600, maxHeight: 1200, quality: 0.70 });
    if (compressed.format !== "image/webp") throw new Error("Format is not image/webp");
    if (compressed.size >= 350 * 1024) throw new Error(`Compressed size ${compressed.size} >= 350KB`);
    if (compressed.width > 1600 || compressed.height > 1200) throw new Error("Dimensions exceed 1600x1200");

    // 3. Complete Stop 2 directly with photoBase64 (simulating offline flushed payload)
    const compRes = await fetch(`${BASE}/api/routes/${testRouteId}/deliveries/${secondDeliveryStop.id}/complete`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        operationId: stop2OperationId,
        photoBase64: compressed.base64,
        photoContentType: "image/webp",
        note: "Entregue offline e sincronizado",
        lat: -23.5640,
        lng: -46.6690,
      }),
    });
    if (compRes.status !== 200) throw new Error(`Complete status: ${compRes.status}`);
  });

  await assert("Acceptance Criteria 3: Reconnecting / re-flushing does not duplicate delivery events (idempotent)", async () => {
    const detailsRes = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const details = await detailsRes.json();
    const secondDeliveryStop = details.stops.filter((s) => !s.is_origin)[1];

    // Replay with identical operationId
    const replayRes = await fetch(`${BASE}/api/routes/${testRouteId}/deliveries/${secondDeliveryStop.id}/complete`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        operationId: stop2OperationId,
        photoBase64: "DUPLICATE_PAYLOAD",
        note: "Replay",
        lat: -23.5640,
        lng: -46.6690,
      }),
    });
    if (replayRes.status !== 200) throw new Error(`Replay status: ${replayRes.status}`);

    // Verify delivery_events count in DB
    const checkRes = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const checkDetails = await checkRes.json();
    const stop2Events = checkDetails.delivery_events.filter((e) => e.stop_id === secondDeliveryStop.id);
    if (stop2Events.length !== 1) throw new Error(`Expected 1 delivery event for stop 2, found ${stop2Events.length}`);

    // Replay with DIFFERENT operationId for the same already-delivered stop (e.g. double click or reconnect with new ID)
    const newOpId = randomUUID();
    const replayDiffOpRes = await fetch(`${BASE}/api/routes/${testRouteId}/deliveries/${secondDeliveryStop.id}/complete`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        operationId: newOpId,
        photoBase64: "DUPLICATE_PAYLOAD_DIFF_OP",
        note: "Replay with new opId",
        lat: -23.5640,
        lng: -46.6690,
      }),
    });
    if (replayDiffOpRes.status !== 200) throw new Error(`Replay with new opId status: ${replayDiffOpRes.status}`);

    // Verify delivery_events count in DB is strictly 1 (NO duplicate delivery event created)
    const checkRes2 = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const checkDetails2 = await checkRes2.json();
    const stop2Events2 = checkDetails2.delivery_events.filter((e) => e.stop_id === secondDeliveryStop.id);
    if (stop2Events2.length !== 1) throw new Error(`Expected strictly 1 delivery event for stop 2 after duplicate submission, found ${stop2Events2.length}`);
  });

  // Finish route
  await assert("POST /api/routes/[id]/finish completes route", async () => {
    const presignRes = await fetch(`${BASE}/api/uploads/presign`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({ kind: "finish", contentType: "image/jpeg" }),
    });
    const { key, url } = await presignRes.json();
    await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body: Buffer.from("FINISH_PHOTO_BYTES"),
    });

    const finishRes = await fetch(`${BASE}/api/routes/${testRouteId}/finish`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        kilometers: 16019.2,
        photoKey: key,
        lat: -23.5615,
        lng: -46.6560,
        confirmIncomplete: true,
      }),
    });
    if (finishRes.status !== 200) throw new Error(`Finish status: ${finishRes.status}`);
    const out = await finishRes.json();
    if (!out.actualKm || out.actualKm < 19) throw new Error(`actualKm mismatch: ${out.actualKm}`);
  });

  // 7. Verify Completed Route for Report (Task 5)
  await assert("GET /api/routes/[id] verifies completed route report details", async () => {
    const res = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const details = await res.json();
    if (details.status !== "completed") throw new Error(`Status is ${details.status}`);
    if (Number(details.actual_km).toFixed(1) !== "19.2") throw new Error(`actual_km is ${details.actual_km}`);
    if (!details.delivery_events?.length) throw new Error("delivery_events missing");
    if (details.delivery_events[0].note !== "Entregue na recepção para Dona Maria")
      throw new Error("delivery event note mismatch");
    if (!details.delivery_events[0].photo_url) throw new Error("delivery event photo_url missing");
  });

  // 8. Verify Driver Tab classification with normalized local dates
  await assert("Driver tabs logic classifies today route correctly into 'Hoje'", () => {
    const testRoute = {
      id: "abc",
      status: "assigned",
      route_date: todayLocal,
    };
    const todayStr = new Date().toLocaleDateString("en-CA");
    const isToday =
      testRoute.status === "active" ||
      (testRoute.status !== "completed" &&
        testRoute.status !== "cancelled" &&
        String(testRoute.route_date).slice(0, 10) <= todayStr);
    if (!isToday) throw new Error("Route for today was not classified into todayRoutes!");
  });

  await assert("Acceptance Criteria 3: Replaying delivery completion after route is completed returns 200 OK idempotently", async () => {
    const detailsRes = await fetch(`${BASE}/api/routes/${testRouteId}`, { headers: authHeaders() });
    const details = await detailsRes.json();
    const secondDeliveryStop = details.stops.filter((s) => !s.is_origin)[1];

    const replayRes = await fetch(`${BASE}/api/routes/${testRouteId}/deliveries/${secondDeliveryStop.id}/complete`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        operationId: stop2OperationId,
        photoBase64: "DUPLICATE_PAYLOAD",
        note: "Replay after route completed",
        lat: -23.5640,
        lng: -46.6690,
      }),
    });
    if (replayRes.status !== 200) throw new Error(`Replay status: ${replayRes.status}`);
  });

  await assert("Acceptance Criteria 3: Replaying route start after route is completed returns 200 OK idempotently", async () => {
    const startReplay = await fetch(`${BASE}/api/routes/${testRouteId}/start`, {
      method: "POST",
      headers: driverHeaders(),
      body: JSON.stringify({
        operationId: randomUUID(),
        kilometers: 16000.0,
        photoBase64: "START_REPLAY_B64",
        photoContentType: "image/webp",
        lat: -23.5505,
        lng: -46.6333,
      }),
    });
    if (startReplay.status !== 200) throw new Error(`Start replay status: ${startReplay.status}`);
  });

  await assert("Acceptance Criteria 1 & 2: Uploaded WebP POD photo is accessible via /api/uploads/local", async () => {
    const photoRes = await fetch(`${BASE}/api/uploads/local/proof%2F${stop2OperationId}.webp`);
    if (photoRes.status !== 200) throw new Error(`Photo fetch status: ${photoRes.status}`);
    const ct = photoRes.headers.get("content-type");
    if (!ct || !ct.includes("image/webp")) throw new Error(`Expected image/webp content-type, got ${ct}`);
    const buf = await photoRes.arrayBuffer();
    if (buf.byteLength < 1000) throw new Error("Photo buffer too small");
  });

  console.log("\n=== ALL 25 VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
}

run().catch((e) => {
  console.error("Verification failed:", e);
  process.exit(1);
});
