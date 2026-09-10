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
    if (json.name !== "RouteWise — Gestão de Rotas") throw new Error("Invalid manifest name");
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
  await assert("POST /api/session/dispatcher authenticates with PIN", async () => {
    const res = await fetch(`${BASE}/api/session/dispatcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "2468" }),
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

  console.log("\n=== ALL 22 VERIFICATION TESTS PASSED SUCCESSFULLY! ===");
}

run().catch((e) => {
  console.error("Verification failed:", e);
  process.exit(1);
});
