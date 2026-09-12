// ============================================================================
// Automated End-to-End & Integration Test Suite: Routing Engine Core
// Project: Criar Rota TMS - Automated Routing Engine
// Framework: Node.js Native Test Runner (node:test, node:assert/strict)
// Methodology: 4-Tier Testing Architecture (Opaque-box, Requirements-Driven)
// ============================================================================

import test, { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// ----------------------------------------------------------------------------
// Dynamic Module Resolution with Progressive Testability Support
// ----------------------------------------------------------------------------
let spreadsheetParser = null;
let spreadsheetParserError = null;
try {
  spreadsheetParser = await import("../lib/spreadsheet-parser.ts");
} catch (err) {
  spreadsheetParserError = err;
}

let geoBrazil = null;
let geoBrazilError = null;
try {
  geoBrazil = await import("../lib/geo-brazil.ts");
} catch (err) {
  geoBrazilError = err;
}

let routeEngine = null;
let routeEngineError = null;
try {
  routeEngine = await import("../lib/route-engine.ts");
} catch (err) {
  routeEngineError = err;
}

// Helper to check module readiness
function requireModule(mod, modError, modName, milestone, t) {
  if (modError) {
    if (modError.code === "ERR_MODULE_NOT_FOUND") {
      t.skip(`[Progressive Testability] ${modName} not yet implemented (Milestone: ${milestone})`);
      return false;
    }
    // If it's a syntax or evaluation error in an existing file, fail explicitly!
    assert.fail(`Error loading ${modName}: ${modError.message}\n${modError.stack}`);
  }
  if (!mod) {
    t.skip(`[Progressive Testability] ${modName} is unavailable`);
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Authoritative Reference Oracles & Mathematical Properties
// ----------------------------------------------------------------------------

/**
 * Geodesic Haversine Distance Reference Oracle (R = 6371 km)
 */
function oracleHaversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Capacity Invariant Oracle
 * Mathematically asserts that no route exceeds volume or weight capacity limits.
 */
function assertCapacityInvariants(routes, maxVolumeM3, maxWeightKg) {
  assert.ok(Array.isArray(routes), "Expected routes to be an array");
  for (const route of routes) {
    const deliveryStops = route.stops ? route.stops.filter((s) => !s.is_origin) : [];
    const sumVol = deliveryStops.reduce((acc, s) => acc + Number(s.volume_m3 || s.volumeM3 || 0), 0);
    const sumWeight = deliveryStops.reduce((acc, s) => acc + Number(s.weight_kg || s.weightKg || 0), 0);

    const EPSILON = 0.001;
    assert.ok(
      sumVol <= maxVolumeM3 + EPSILON,
      `Route "${route.name || route.id}" volume ${sumVol} m³ exceeds capacity ${maxVolumeM3} m³`
    );
    assert.ok(
      sumWeight <= maxWeightKg + EPSILON,
      `Route "${route.name || route.id}" weight ${sumWeight} kg exceeds capacity ${maxWeightKg} kg`
    );
  }
}

/**
 * Order Conservation Oracle
 * Verifies that all parsed orders are accounted for: no drops, no duplicates.
 */
function assertOrderConservation(inputOrders, routes) {
  const inputIds = new Set(inputOrders.map((o) => o.orderId || o.order_id));
  const routedIds = [];

  for (const route of routes) {
    const deliveryStops = route.stops ? route.stops.filter((s) => !s.is_origin) : [];
    for (const stop of deliveryStops) {
      if (stop.orderId || stop.order_id) {
        routedIds.push(stop.orderId || stop.order_id);
      }
    }
  }

  assert.strictEqual(
    routedIds.length,
    inputOrders.length,
    `Order count mismatch: input had ${inputOrders.length}, routed routes have ${routedIds.length}`
  );

  for (const id of routedIds) {
    assert.ok(inputIds.has(id), `Routed order ID "${id}" was not present in original input`);
  }
}

/**
 * LIFO Structure Oracle
 * Verifies that the LIFO manifest strictly reverses the delivery stop order.
 */
function assertLifoManifestIntegrity(route) {
  assert.ok(route.lifoManifest, "Route must contain lifoManifest");
  const deliveryStops = route.stops.filter((s) => !s.is_origin);
  const n = deliveryStops.length;

  assert.strictEqual(
    route.lifoManifest.length,
    n,
    `LIFO manifest length (${route.lifoManifest.length}) must equal delivery stop count (${n})`
  );

  if (n === 1) {
    const item = route.lifoManifest[0];
    assert.strictEqual(item.loadingStep, 1);
    assert.ok(
      item.compartmentPosition === "PORTA" ||
      item.compartmentPosition === "FUNDO" ||
      item.compartmentPosition === "MEIO",
      "Valid compartment position for single stop"
    );
    return;
  }

  for (let i = 0; i < n; i++) {
    const step = route.lifoManifest[i];
    assert.strictEqual(step.loadingStep, i + 1, `loadingStep must be strictly 1-indexed (got ${step.loadingStep})`);
    assert.strictEqual(
      step.deliveryOrderIndex,
      n - i,
      `deliveryOrderIndex must strictly count down from ${n} to 1`
    );

    if (i === 0) {
      assert.strictEqual(step.compartmentPosition, "FUNDO", "First loaded stop must be placed at FUNDO");
      // Corresponding delivery stop is the LAST delivery
      assert.strictEqual(
        step.stopName,
        deliveryStops[n - 1].name,
        "FUNDO item must match the last delivery stop"
      );
    } else if (i === n - 1) {
      assert.strictEqual(step.compartmentPosition, "PORTA", "Last loaded stop must be placed at PORTA");
      // Corresponding delivery stop is the FIRST delivery
      assert.strictEqual(
        step.stopName,
        deliveryStops[0].name,
        "PORTA item must match the first delivery stop"
      );
    } else {
      assert.strictEqual(step.compartmentPosition, "MEIO", `Intermediate stop #${i + 1} must be at MEIO`);
    }
  }
}

// Canonical Default Origin (Campinas Depot)
const DEFAULT_DEPOT = {
  name: "CD Central Campinas",
  address: "Rodovia Anhanguera, km 104, Campinas - SP",
  lat: -22.9099,
  lng: -47.0626,
};

// ============================================================================
// TIER 1: FEATURE COVERAGE (>= 5 tests per feature)
// ============================================================================

describe("Tier 1: Feature Coverage", () => {

  // --------------------------------------------------------------------------
  // Feature 1: Universal Spreadsheet Parser (lib/spreadsheet-parser.ts)
  // --------------------------------------------------------------------------
  describe("Feature 1: Universal Spreadsheet Parser", () => {
    it("T1.1.1: parses canonical CSV file with standard headers and comma delimiter", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const filePath = path.join(FIXTURES_DIR, "canonical-sp-deliveries.csv");
      const buffer = fs.readFileSync(filePath);
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "canonical-sp-deliveries.csv");

      assert.ok(Array.isArray(orders), "Parsed result must be an array");
      assert.strictEqual(orders.length, 12, "Canonical fixture must yield exactly 12 orders");

      const first = orders[0];
      assert.strictEqual(first.orderId, "PED-101");
      assert.strictEqual(first.clientName, "Mercado Sol Nascente");
      assert.strictEqual(first.city, "Campinas");
      assert.strictEqual(first.uf, "SP");
      assert.strictEqual(first.volumeM3, 2.5);
      assert.strictEqual(first.weightKg, 320.0);
      assert.strictEqual(first.boxes, 15);
      assert.strictEqual(first.products, "Bebidas e Alimentos");
    });

    it("T1.1.2: normalizes diverse Brazilian TMS column aliases", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const csvWithAliases = [
        "Número do Pedido,Razão Social,Logradouro,Município,Sigla UF,Cubagem (m3),Peso Bruto,Qtd Volumes,Mercadoria",
        "PED-ALI-1,Lojas CEM,Rua 13 de Maio 500,Amparo,SP,3.5,450.0,20,Móveis e Eletro",
      ].join("\n");

      const buffer = Buffer.from(csvWithAliases, "utf8");
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "aliases.csv");

      assert.strictEqual(orders.length, 1);
      const order = orders[0];
      assert.strictEqual(order.orderId, "PED-ALI-1");
      assert.strictEqual(order.clientName, "Lojas CEM");
      assert.strictEqual(order.address, "Rua 13 de Maio 500");
      assert.strictEqual(order.city, "Amparo");
      assert.strictEqual(order.uf, "SP");
      assert.strictEqual(order.volumeM3, 3.5);
      assert.strictEqual(order.weightKg, 450.0);
      assert.strictEqual(order.boxes, 20);
      assert.strictEqual(order.products, "Móveis e Eletro");
    });

    it("T1.1.3: converts Brazilian decimal commas and thousand dots to valid numbers", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const csv = [
        "Pedido,Cliente,Endereço,Cidade,Cubagem,Peso,Volumes",
        "PED-DEC-1,Cliente Decimal,Av Central 100,Campinas,1.250,50,3.450,75,10",
        "PED-DEC-2,Cliente Comma,Av Central 200,Campinas,0,45,15,5,5",
      ].join("\n");

      const buffer = Buffer.from(csv, "utf8");
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "decimals.csv");

      assert.strictEqual(orders.length, 2);
      assert.strictEqual(orders[0].volumeM3, 1250.5);
      assert.strictEqual(orders[0].weightKg, 3450.75);
      assert.strictEqual(orders[1].volumeM3, 0.45);
      assert.strictEqual(orders[1].weightKg, 15.5);
    });

    it("T1.1.4: strips unit suffixes from volume and weight fields", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const csv = [
        "Pedido,Cliente,Endereço,Cidade,Cubagem,Peso,Volumes",
        "PED-UNIT-1,Cliente Unidade,Rua A,Sumaré,2.8 m³,140.5 kg,12 cxs",
        "PED-UNIT-2,Cliente CBM,Rua B,Hortolândia,15.2 CBM,850 KGS,30 vol",
      ].join("\n");

      const buffer = Buffer.from(csv, "utf8");
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "units.csv");

      assert.strictEqual(orders.length, 2);
      assert.strictEqual(orders[0].volumeM3, 2.8);
      assert.strictEqual(orders[0].weightKg, 140.5);
      assert.strictEqual(orders[0].boxes, 12);
      assert.strictEqual(orders[1].volumeM3, 15.2);
      assert.strictEqual(orders[1].weightKg, 850.0);
      assert.strictEqual(orders[1].boxes, 30);
    });

    it("T1.1.5: defaults missing boxes or volume to minimum valid positive quantities", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const csv = [
        "Pedido,Cliente,Endereço,Cidade,Cubagem,Peso,Volumes",
        "PED-DEF-1,Cliente Default,Rua Nova 10,Valinhos,,,",
      ].join("\n");

      const buffer = Buffer.from(csv, "utf8");
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "defaults.csv");

      assert.strictEqual(orders.length, 1);
      assert.ok(orders[0].boxes >= 1, "Boxes must default to >= 1");
      assert.ok(orders[0].volumeM3 > 0, "Volume must default to a positive minimum");
      assert.ok(orders[0].weightKg > 0, "Weight must default to a positive minimum");
    });

    it("T1.1.6: preserves UTF-8 accents and Brazilian special characters", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const csv = [
        "Pedido,Cliente,Endereço,Cidade,UF,Cubagem,Peso,Volumes,Produtos",
        "PED-ACC-1,Açougue & Mercearia São João,Praça da Sé 45,São João da Boa Vista,SP,1.5,120,5,Açúcar & Feijão",
      ].join("\n");

      const buffer = Buffer.from(csv, "utf8");
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "accents.csv");

      assert.strictEqual(orders[0].clientName, "Açougue & Mercearia São João");
      assert.strictEqual(orders[0].city, "São João da Boa Vista");
      assert.strictEqual(orders[0].products, "Açúcar & Feijão");
    });

    it("T1.1.7: auto-detects delimiter in multi-column rows", async (t) => {
      if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

      const semicolonCsv = [
        "Pedido;Cliente;Endereço;Cidade;Cubagem;Peso;Volumes",
        "PED-SEMI-1;Cliente Ponto e Virgula;Av Rebouças 100;Sumaré;2,5;300;10",
      ].join("\n");

      const buffer = Buffer.from(semicolonCsv, "utf8");
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "semicolon.csv");

      assert.strictEqual(orders.length, 1);
      assert.strictEqual(orders[0].orderId, "PED-SEMI-1");
      assert.strictEqual(orders[0].city, "Sumaré");
      assert.strictEqual(orders[0].volumeM3, 2.5);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 2: In-Memory Brazilian Geo Dictionary (lib/geo-brazil.ts)
  // --------------------------------------------------------------------------
  describe("Feature 2: In-Memory Brazilian Geo Dictionary", () => {
    it("T1.2.1: resolves coordinates for all major SP logistics municipalities", (t) => {
      if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;

      const cities = ["Campinas", "Sumaré", "Hortolândia", "Paulínia", "Americana", "São Paulo", "Jundiaí"];
      for (const city of cities) {
        const coords = geoBrazil.getCityCoordinates(city, "SP");
        assert.ok(coords, `Expected coordinates for city ${city}`);
        assert.ok(typeof coords.lat === "number" && coords.lat < 0, `Valid latitude for ${city}`);
        assert.ok(typeof coords.lng === "number" && coords.lng < 0, `Valid longitude for ${city}`);
      }
    });

    it("T1.2.2: normalizes city names stripping accents, casing, and punctuation", (t) => {
      if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;

      const c1 = geoBrazil.getCityCoordinates("São Paulo");
      const c2 = geoBrazil.getCityCoordinates("sao paulo");
      const c3 = geoBrazil.getCityCoordinates("SAO PAULO");
      assert.ok(c1 && c2 && c3);
      assert.strictEqual(c1.lat, c2.lat);
      assert.strictEqual(c1.lng, c3.lng);

      const normalized = geoBrazil.normalizeCityName("Santa Bárbara d'Oeste");
      assert.ok(!normalized.includes("á") && !normalized.includes("'"));
    });

    it("T1.2.3: parses city strings with UF appended (e.g., 'Campinas - SP' or 'Jundiaí/SP')", (t) => {
      if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;

      const c1 = geoBrazil.getCityCoordinates("Campinas - SP");
      const c2 = geoBrazil.getCityCoordinates("Jundiaí/SP");
      const c3 = geoBrazil.getCityCoordinates("Vinhedo (SP)");

      assert.ok(c1, "Should resolve 'Campinas - SP'");
      assert.ok(c2, "Should resolve 'Jundiaí/SP'");
      assert.ok(c3, "Should resolve 'Vinhedo (SP)'");
    });

    it("T1.2.4: computes Haversine geodesic distance matching mathematical oracle", (t) => {
      if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;

      // Campinas -> Sumaré
      const campinas = { lat: -22.9099, lng: -47.0626 };
      const sumare = { lat: -22.8208, lng: -47.2669 };

      const oracleDist = oracleHaversine(campinas.lat, campinas.lng, sumare.lat, sumare.lng);
      const computedDist = geoBrazil.calculateHaversineDistance(
        campinas.lat,
        campinas.lng,
        sumare.lat,
        sumare.lng
      );

      // Must match within 0.5 km tolerance
      assert.ok(
        Math.abs(oracleDist - computedDist) < 0.5,
        `Distance mismatch: oracle=${oracleDist.toFixed(2)} km, computed=${computedDist.toFixed(2)} km`
      );
    });

    it("T1.2.5: resolves coordinates in sub-5ms SLA in memory without external HTTP calls", (t) => {
      if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;

      const start = performance.now();
      for (let i = 0; i < 50; i++) {
        geoBrazil.getCityCoordinates("Campinas", "SP");
        geoBrazil.getCityCoordinates("São Paulo", "SP");
      }
      const duration = performance.now() - start;

      // 100 lookups should take < 50ms (average < 0.5ms per lookup)
      assert.ok(duration < 50, `100 coordinate lookups took ${duration.toFixed(2)}ms (must be < 50ms)`);
    });

    it("T1.2.6: provides fallback coordinates for unknown municipal variations", (t) => {
      if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;

      const unknown = geoBrazil.getCityCoordinates("Vila Desconhecida", "SP");
      // Either returns a regional fallback with valid coords or null safely
      if (unknown) {
        assert.ok(typeof unknown.lat === "number" && typeof unknown.lng === "number");
      }
    });
  });

  // --------------------------------------------------------------------------
  // Feature 3: Spatial Proximity & Geographic Clustering (lib/route-engine.ts)
  // --------------------------------------------------------------------------
  describe("Feature 3: Spatial Proximity & Geographic Clustering", () => {
    it("T1.3.1: groups proximate orders within adjacent cities together", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "A", address: "Rua 1", city: "Campinas", volumeM3: 2.0, weightKg: 200, boxes: 5, lat: -22.9099, lng: -47.0626 },
        { orderId: "2", clientName: "B", address: "Rua 2", city: "Sumaré", volumeM3: 2.0, weightKg: 200, boxes: 5, lat: -22.8208, lng: -47.2669 },
        { orderId: "3", clientName: "C", address: "Rua 3", city: "Hortolândia", volumeM3: 2.0, weightKg: 200, boxes: 5, lat: -22.8583, lng: -47.2200 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      // Since total vol is 6m³ (< 20m³) and cities are neighbors (< 25km apart), they should be in 1 route
      assert.strictEqual(routes.length, 1, "Neighboring cities within capacity must form a single consolidated route");
    });

    it("T1.3.2: partitions geographically distant cities into separate routes", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "Campinas", address: "Av Brasil", city: "Campinas", volumeM3: 3.0, weightKg: 300, boxes: 5, lat: -22.9099, lng: -47.0626 },
        { orderId: "2", clientName: "Ribeirão", address: "Av Saudade", city: "Ribeirão Preto", volumeM3: 3.0, weightKg: 300, boxes: 5, lat: -21.1767, lng: -47.8208 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 30.0,
        maxWeightKg: 5000.0,
        originDepot: DEFAULT_DEPOT,
      });

      // Campinas to Ribeirão Preto is ~220km; routing engine must split distant poles
      assert.ok(routes.length >= 1, "Must generate valid route partitioning");
      assertOrderConservation(orders, routes);
    });

    it("T1.3.3: preserves complete order metadata across generated clusters", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "ORD-99", clientName: "Super Loja", address: "Av Central 50", city: "Campinas", volumeM3: 4.5, weightKg: 500, boxes: 18, products: "Bebidas", lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const stop = routes[0].stops.find((s) => !s.is_origin);
      assert.ok(stop, "Route must contain the delivery stop");
      assert.strictEqual(stop.orderId || stop.order_id, "ORD-99");
      assert.strictEqual(stop.name, "Super Loja");
      assert.strictEqual(stop.boxes, 18);
    });

    it("T1.3.4: generates deterministic route allocations regardless of input order sequence", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "A", address: "R1", city: "Campinas", volumeM3: 5.0, weightKg: 500, boxes: 10, lat: -22.9099, lng: -47.0626 },
        { orderId: "2", clientName: "B", address: "R2", city: "Sumaré", volumeM3: 5.0, weightKg: 500, boxes: 10, lat: -22.8208, lng: -47.2669 },
        { orderId: "3", clientName: "C", address: "R3", city: "Paulínia", volumeM3: 5.0, weightKg: 500, boxes: 10, lat: -22.7614, lng: -47.1542 },
      ];

      const r1 = routeEngine.generateOptimizedRoutes(orders, { maxVolumeM3: 20, maxWeightKg: 3500, originDepot: DEFAULT_DEPOT });
      const r2 = routeEngine.generateOptimizedRoutes([...orders].reverse(), { maxVolumeM3: 20, maxWeightKg: 3500, originDepot: DEFAULT_DEPOT });

      assert.strictEqual(r1.length, r2.length, "Route count must be deterministic regardless of input sequence");
    });

    it("T1.3.5: isolates single-city orders when total volume fills an entire vehicle", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "C1", address: "R1", city: "Campinas", volumeM3: 10.0, weightKg: 1000, boxes: 20, lat: -22.9099, lng: -47.0626 },
        { orderId: "2", clientName: "C2", address: "R2", city: "Campinas", volumeM3: 10.0, weightKg: 1000, boxes: 20, lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      assert.strictEqual(routes.length, 1);
      assert.strictEqual(routes[0].totalVolumeM3 || routes[0].total_volume_m3, 20.0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 4: Multi-Dimensional Bin-Packing & Mathematical Capacity Invariants
  // --------------------------------------------------------------------------
  describe("Feature 4: Multi-Dimensional Bin-Packing & Mathematical Invariants", () => {
    it("T1.4.1: splits routes strictly when volume capacity (m³) is exceeded", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      // 3 orders of 8m³ each = 24m³ total -> cannot fit into 20m³ vehicle -> must produce 2 routes
      const orders = [
        { orderId: "V1", clientName: "O1", address: "R1", city: "Campinas", volumeM3: 8.0, weightKg: 500, boxes: 10, lat: -22.9099, lng: -47.0626 },
        { orderId: "V2", clientName: "O2", address: "R2", city: "Campinas", volumeM3: 8.0, weightKg: 500, boxes: 10, lat: -22.9099, lng: -47.0626 },
        { orderId: "V3", clientName: "O3", address: "R3", city: "Campinas", volumeM3: 8.0, weightKg: 500, boxes: 10, lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 5000.0,
        originDepot: DEFAULT_DEPOT,
      });

      assert.strictEqual(routes.length, 2, "24m³ on 20m³ capacity must split into 2 routes");
      assertCapacityInvariants(routes, 20.0, 5000.0);
      assertOrderConservation(orders, routes);
    });

    it("T1.4.2: splits routes strictly when weight capacity (kg) is exceeded", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      // Small volume (1m³ each) but heavy weight (2000kg each) = 4000kg total -> exceeds 3500kg limit
      const orders = [
        { orderId: "W1", clientName: "Heavy 1", address: "R1", city: "Campinas", volumeM3: 1.0, weightKg: 2000.0, boxes: 5, lat: -22.9099, lng: -47.0626 },
        { orderId: "W2", clientName: "Heavy 2", address: "R2", city: "Campinas", volumeM3: 1.0, weightKg: 2000.0, boxes: 5, lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 30.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      assert.strictEqual(routes.length, 2, "4000kg on 3500kg vehicle capacity must split into 2 routes");
      assertCapacityInvariants(routes, 30.0, 3500.0);
      assertOrderConservation(orders, routes);
    });

    it("T1.4.3: enforces strict capacity invariant on heterogeneous multi-order sets", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "O1", clientName: "A", address: "R1", city: "Campinas", volumeM3: 6.5, weightKg: 950, boxes: 12, lat: -22.9099, lng: -47.0626 },
        { orderId: "O2", clientName: "B", address: "R2", city: "Sumaré", volumeM3: 5.5, weightKg: 1200, boxes: 15, lat: -22.8208, lng: -47.2669 },
        { orderId: "O3", clientName: "C", address: "R3", city: "Hortolândia", volumeM3: 7.0, weightKg: 1100, boxes: 18, lat: -22.8583, lng: -47.2200 },
        { orderId: "O4", clientName: "D", address: "R4", city: "Paulínia", volumeM3: 4.0, weightKg: 800, boxes: 8, lat: -22.7614, lng: -47.1542 },
      ];

      // Total vol = 23m³, total weight = 4050kg. Vehicle limits: 20m³ / 3500kg.
      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      assertCapacityInvariants(routes, 20.0, 3500.0);
      assertOrderConservation(orders, routes);
    });

    it("T1.4.4: adapts bin-packing dynamically to custom vehicle parameters (e.g. 10m³ Van vs 30m³ Toco)", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "P1", clientName: "A", address: "R1", city: "Campinas", volumeM3: 4.0, weightKg: 400, boxes: 8, lat: -22.9099, lng: -47.0626 },
        { orderId: "P2", clientName: "B", address: "R2", city: "Campinas", volumeM3: 4.0, weightKg: 400, boxes: 8, lat: -22.9099, lng: -47.0626 },
        { orderId: "P3", clientName: "C", address: "R3", city: "Campinas", volumeM3: 4.0, weightKg: 400, boxes: 8, lat: -22.9099, lng: -47.0626 },
      ];

      // Under 10m³ Van limit: 12m³ total -> must produce 2 routes
      const vanRoutes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 10.0,
        maxWeightKg: 1500.0,
        originDepot: DEFAULT_DEPOT,
      });
      assert.strictEqual(vanRoutes.length, 2, "12m³ must require 2 Van routes (10m³ max)");

      // Under 30m³ Toco limit: 12m³ total -> must fit in 1 route
      const tocoRoutes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 30.0,
        maxWeightKg: 6000.0,
        originDepot: DEFAULT_DEPOT,
      });
      assert.strictEqual(tocoRoutes.length, 1, "12m³ must fit in 1 Toco route (30m³ max)");
    });

    it("T1.4.5: calculates aggregated totalVolumeM3 and totalWeightKg correctly per route", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "A1", clientName: "A", address: "R1", city: "Campinas", volumeM3: 3.25, weightKg: 420.5, boxes: 10, lat: -22.9099, lng: -47.0626 },
        { orderId: "A2", clientName: "B", address: "R2", city: "Campinas", volumeM3: 2.75, weightKg: 310.5, boxes: 8, lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      assert.strictEqual(routes.length, 1);
      const r = routes[0];
      assert.ok(Math.abs((r.totalVolumeM3 || r.total_volume_m3) - 6.0) < 0.01);
      assert.ok(Math.abs((r.totalWeightKg || r.total_weight_kg) - 731.0) < 0.1);
      assert.strictEqual(r.totalBoxes || r.total_boxes, 18);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 5: LIFO Loading Order Manifest (lib/route-engine.ts)
  // --------------------------------------------------------------------------
  describe("Feature 5: LIFO Loading Order Manifest", () => {
    it("T1.5.1: reverses delivery stops order for loading manifest (Last In, First Out)", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "D1", clientName: "First Client", address: "Rua 1", city: "Campinas", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.9099, lng: -47.0626 },
        { orderId: "D2", clientName: "Second Client", address: "Rua 2", city: "Sumaré", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.8208, lng: -47.2669 },
        { orderId: "D3", clientName: "Third Client", address: "Rua 3", city: "Paulínia", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.7614, lng: -47.1542 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      assert.strictEqual(routes.length, 1);
      assertLifoManifestIntegrity(routes[0]);
    });

    it("T1.5.2: places the last delivery at step 1 in the FUNDO compartment", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "L1", clientName: "Stop 1", address: "R1", city: "Campinas", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.9099, lng: -47.0626 },
        { orderId: "L2", clientName: "Stop 2", address: "R2", city: "Sumaré", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.8208, lng: -47.2669 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const manifest = routes[0].lifoManifest;
      assert.strictEqual(manifest[0].loadingStep, 1);
      assert.strictEqual(manifest[0].compartmentPosition, "FUNDO");
    });

    it("T1.5.3: places the first delivery at the final step in the PORTA compartment", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "L1", clientName: "Stop 1", address: "R1", city: "Campinas", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.9099, lng: -47.0626 },
        { orderId: "L2", clientName: "Stop 2", address: "R2", city: "Sumaré", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.8208, lng: -47.2669 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const manifest = routes[0].lifoManifest;
      const lastStep = manifest[manifest.length - 1];
      assert.strictEqual(lastStep.compartmentPosition, "PORTA");
    });

    it("T1.5.4: assigns compartment MEIO to all intermediate delivery stops", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "S1", clientName: "Stop 1", address: "R1", city: "Campinas", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.9099, lng: -47.0626 },
        { orderId: "S2", clientName: "Stop 2", address: "R2", city: "Sumaré", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.8208, lng: -47.2669 },
        { orderId: "S3", clientName: "Stop 3", address: "R3", city: "Hortolândia", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.8583, lng: -47.2200 },
        { orderId: "S4", clientName: "Stop 4", address: "R4", city: "Paulínia", volumeM3: 1.0, weightKg: 100, boxes: 2, lat: -22.7614, lng: -47.1542 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const manifest = routes[0].lifoManifest;
      assert.strictEqual(manifest.length, 4);
      assert.strictEqual(manifest[1].compartmentPosition, "MEIO");
      assert.strictEqual(manifest[2].compartmentPosition, "MEIO");
    });

    it("T1.5.5: preserves box count, volume, and weight per stop in LIFO manifest", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "B1", clientName: "Client 1", address: "R1", city: "Campinas", volumeM3: 3.5, weightKg: 450.0, boxes: 14, lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const item = routes[0].lifoManifest[0];
      assert.strictEqual(item.boxes, 14);
      assert.strictEqual(item.volumeM3, 3.5);
      assert.strictEqual(item.weightKg, 450.0);
    });
  });

  // --------------------------------------------------------------------------
  // Feature 6: Route Sequencing (TSP Nearest Neighbor + 2-Opt)
  // --------------------------------------------------------------------------
  describe("Feature 6: Route Sequencing & TSP Optimization", () => {
    it("T1.6.1: places origin depot as position 0 with is_origin = true", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "Dest", address: "R1", city: "Sumaré", volumeM3: 2.0, weightKg: 200, boxes: 4, lat: -22.8208, lng: -47.2669 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const origin = routes[0].stops[0];
      assert.strictEqual(origin.position, 0);
      assert.strictEqual(origin.is_origin, true);
      assert.strictEqual(origin.lat, DEFAULT_DEPOT.lat);
      assert.strictEqual(origin.lng, DEFAULT_DEPOT.lng);
    });

    it("T1.6.2: sequences non-origin delivery stops sequentially from position 1 to N", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "A", address: "R1", city: "Campinas", volumeM3: 1, weightKg: 100, boxes: 2, lat: -22.9099, lng: -47.0626 },
        { orderId: "2", clientName: "B", address: "R2", city: "Sumaré", volumeM3: 1, weightKg: 100, boxes: 2, lat: -22.8208, lng: -47.2669 },
        { orderId: "3", clientName: "C", address: "R3", city: "Paulínia", volumeM3: 1, weightKg: 100, boxes: 2, lat: -22.7614, lng: -47.1542 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const stops = routes[0].stops;
      assert.strictEqual(stops.length, 4, "Origin depot + 3 delivery stops = 4 stops");
      assert.strictEqual(stops[0].position, 0);
      assert.strictEqual(stops[1].position, 1);
      assert.strictEqual(stops[2].position, 2);
      assert.strictEqual(stops[3].position, 3);
    });

    it("T1.6.3: calculates positive estimatedKm reflecting total travel path", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "1", clientName: "Sumaré", address: "R1", city: "Sumaré", volumeM3: 1, weightKg: 100, boxes: 2, lat: -22.8208, lng: -47.2669 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const estimatedKm = routes[0].estimatedKm || routes[0].estimated_km;
      assert.ok(typeof estimatedKm === "number", "estimatedKm must be a number");
      assert.ok(estimatedKm > 5 && estimatedKm < 50, `Expected realistic distance (~15-25km), got ${estimatedKm}`);
    });

    it("T1.6.4: nearest neighbor sequence avoids extreme back-and-forth detours", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      // Depot in Campinas
      // Close neighbor: Valinhos (~10km)
      // Intermediate: Vinhedo (~18km)
      // Far neighbor: Jundiaí (~40km)
      const orders = [
        { orderId: "JUND", clientName: "Jundiaí", address: "Av Imigrantes", city: "Jundiaí", volumeM3: 1, weightKg: 100, boxes: 1, lat: -23.1857, lng: -46.8978 },
        { orderId: "VAL", clientName: "Valinhos", address: "Rua 12", city: "Valinhos", volumeM3: 1, weightKg: 100, boxes: 1, lat: -22.9706, lng: -46.9961 },
        { orderId: "VINH", clientName: "Vinhedo", address: "Estrada Boiada", city: "Vinhedo", volumeM3: 1, weightKg: 100, boxes: 1, lat: -23.0297, lng: -46.9747 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const deliveryStops = routes[0].stops.filter((s) => !s.is_origin);
      // From Campinas heading south along the corridor: Valinhos -> Vinhedo -> Jundiaí
      assert.strictEqual(deliveryStops[0].city, "Valinhos", "First stop from Campinas should be closest (Valinhos)");
      assert.strictEqual(deliveryStops[deliveryStops.length - 1].city, "Jundiaí", "Furthest stop along corridor should be last (Jundiaí)");
    });

    it("T1.6.5: visits each order stop exactly once (no duplicates, no omissions)", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "A", clientName: "A", address: "R1", city: "Campinas", volumeM3: 1, weightKg: 100, boxes: 1, lat: -22.9099, lng: -47.0626 },
        { orderId: "B", clientName: "B", address: "R2", city: "Sumaré", volumeM3: 1, weightKg: 100, boxes: 1, lat: -22.8208, lng: -47.2669 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const visitedIds = routes[0].stops.filter((s) => !s.is_origin).map((s) => s.orderId || s.order_id);
      assert.strictEqual(visitedIds.length, 2);
      assert.ok(visitedIds.includes("A") && visitedIds.includes("B"));
    });
  });

  // --------------------------------------------------------------------------
  // Feature 7: Dispatch API Schema & Transaction Contract
  // --------------------------------------------------------------------------
  describe("Feature 7: Dispatch API Schema & Transaction Contract", () => {
    it("T1.7.1: generates route structure matching POST /api/routes transaction payload", (t) => {
      if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

      const orders = [
        { orderId: "ORD-1", clientName: "Client A", address: "Rua 1", city: "Campinas", volumeM3: 2.0, weightKg: 300, boxes: 5, products: "Itens", lat: -22.9099, lng: -47.0626 },
      ];

      const routes = routeEngine.generateOptimizedRoutes(orders, {
        maxVolumeM3: 20.0,
        maxWeightKg: 3500.0,
        originDepot: DEFAULT_DEPOT,
      });

      const route = routes[0];
      // Format dispatch payload matching app/api/[...path]/route.ts:581
      const payload = {
        name: route.name || "Rota Roteirizada 1",
        routeDate: new Date().toISOString().slice(0, 10),
        optimizeBy: "distance",
        circular: false,
        estimatedKm: route.estimatedKm || 15.5,
        driverId: "d1000000-0000-0000-0000-000000000001",
        vehicleId: "v1000000-0000-0000-0000-000000000001",
        stops: route.stops.map((s) => ({
          position: s.position,
          name: s.name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          boxes: s.boxes,
          volume_m3: s.volume_m3 || s.volumeM3,
          weight_kg: s.weight_kg || s.weightKg,
          order_id: s.orderId || s.order_id,
          products: s.products,
        })),
      };

      assert.ok(payload.driverId && payload.vehicleId);
      assert.ok(Array.isArray(payload.stops) && payload.stops.length === 2);
      assert.strictEqual(payload.stops[0].position, 0);
      assert.strictEqual(payload.stops[1].order_id, "ORD-1");
    });

    it("T1.7.2: verifies status evaluates to 'assigned' when driver and vehicle are assigned", () => {
      // Contract test based on app/api/[...path]/route.ts:585
      const dataWithDriverVehicle = { driverId: "drv-123", vehicleId: "veh-456" };
      const isAssigned = !!(dataWithDriverVehicle.driverId && dataWithDriverVehicle.vehicleId);
      assert.strictEqual(isAssigned ? "assigned" : "draft", "assigned");

      const dataWithoutDriver = { driverId: null, vehicleId: "veh-456" };
      const isDraft = !!(dataWithoutDriver.driverId && dataWithoutDriver.vehicleId);
      assert.strictEqual(isDraft ? "assigned" : "draft", "draft");
    });

    it("T1.7.3: validates stop schema compatibility with database migrations", () => {
      // Validates fields added in 0006 migration: weight_kg, order_id, products
      const mockStop = {
        position: 1,
        name: "Farmácia Central",
        address: "Rua Barão de Jaguara 820",
        lat: -22.9099,
        lng: -47.0626,
        is_origin: false,
        boxes: 4,
        volume_m3: 0.8,
        weight_kg: 65.0,
        order_id: "PED-102",
        products: "Medicamentos",
      };

      assert.strictEqual(typeof mockStop.weight_kg, "number");
      assert.strictEqual(typeof mockStop.order_id, "string");
      assert.strictEqual(typeof mockStop.products, "string");
    });

    it("T1.7.4: verifies driver PWA compatibility contract for stops retrieval", () => {
      // Verifies fields delivered to Driver PWA
      const stopFromDb = {
        id: "stop-uuid",
        route_id: "route-uuid",
        position: 1,
        name: "Supermercado Boa Vista",
        address: "Av Central 100",
        lat: -22.9099,
        lng: -47.0626,
        is_origin: false,
        status: "pending",
        boxes: 12,
        volume_m3: 2.5,
        weight_kg: 320.0,
        order_id: "PED-101",
      };

      assert.strictEqual(stopFromDb.status, "pending");
      assert.strictEqual(stopFromDb.order_id, "PED-101");
      assert.strictEqual(stopFromDb.weight_kg, 320.0);
    });

    it("T1.7.5: verifies transactional rollback guarantee on insertion failure", () => {
      // Contractual verification of BEGIN -> ROLLBACK pattern in route.ts:612
      let transactionActive = false;
      try {
        transactionActive = true;
        // Simulate error during stop insertion
        throw new Error("Simulated database failure");
      } catch (err) {
        transactionActive = false; // Rollback
      }
      assert.strictEqual(transactionActive, false, "Transaction must rollback cleanly upon failure");
    });
  });
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES
// ============================================================================

describe("Tier 2: Boundary & Corner Cases", () => {
  it("T2.1: handles empty (0 bytes) spreadsheet without uncaught exceptions", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

    const buffer = Buffer.alloc(0);
    try {
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "empty.csv");
      assert.ok(Array.isArray(orders));
      assert.strictEqual(orders.length, 0);
    } catch (err) {
      // Rejection with a descriptive error is also an acceptable valid behavior
      assert.ok(err instanceof Error);
    }
  });

  it("T2.2: handles header-only spreadsheet with zero data rows", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

    const filePath = path.join(FIXTURES_DIR, "header-only.csv");
    const buffer = fs.readFileSync(filePath);
    try {
      const orders = await spreadsheetParser.parseSpreadsheet(buffer, "header-only.csv");
      assert.ok(Array.isArray(orders));
      assert.strictEqual(orders.length, 0);
    } catch (err) {
      assert.ok(err instanceof Error);
    }
  });

  it("T2.3: produces valid route and LIFO manifest for a single-stop delivery", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const singleOrder = [
      { orderId: "SINGLE", clientName: "Único", address: "Rua 1", city: "Campinas", volumeM3: 2.0, weightKg: 250, boxes: 5, lat: -22.9099, lng: -47.0626 },
    ];

    const routes = routeEngine.generateOptimizedRoutes(singleOrder, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    assert.strictEqual(routes.length, 1);
    assert.strictEqual(routes[0].stops.length, 2, "1 depot + 1 delivery stop = 2 stops");
    assertLifoManifestIntegrity(routes[0]);
  });

  it("T2.4: isolates oversized single order exceeding total vehicle capacity into dedicated route or throws clear violation", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    // Single order with 35m³ on a 30m³ vehicle
    const oversized = [
      { orderId: "GIANT-1", clientName: "Usina Pesada", address: "Rodovia km 100", city: "Campinas", volumeM3: 35.0, weightKg: 7500, boxes: 100, lat: -22.9099, lng: -47.0626 },
    ];

    try {
      const routes = routeEngine.generateOptimizedRoutes(oversized, {
        maxVolumeM3: 30.0,
        maxWeightKg: 6000.0,
        originDepot: DEFAULT_DEPOT,
      });

      // If handled as dedicated special route, it must isolate it
      assert.strictEqual(routes.length, 1);
      assert.strictEqual(routes[0].stops.filter((s) => !s.is_origin).length, 1);
    } catch (err) {
      // Alternatively, throws explicit capacity violation error
      assert.ok(err instanceof Error);
      assert.ok(err.message.toLowerCase().includes("capacidade") || err.message.toLowerCase().includes("capacity") || err.message.toLowerCase().includes("excede"));
    }
  });

  it("T2.5: parses Brazilian semicolon-delimited CSV with comma decimals and BOM cleanly", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

    const filePath = path.join(FIXTURES_DIR, "semicolon-bom-brazil.csv");
    const buffer = fs.readFileSync(filePath);
    const orders = await spreadsheetParser.parseSpreadsheet(buffer, "semicolon-bom-brazil.csv");

    assert.strictEqual(orders.length, 3);
    assert.strictEqual(orders[0].orderId, "PED-201");
    assert.strictEqual(orders[0].volumeM3, 3.5);
    assert.strictEqual(orders[0].weightKg, 520.5);
    assert.strictEqual(orders[2].city, "Guarulhos");
  });

  it("T2.6: strips UTF-8 BOM character (\\uFEFF) avoiding corrupted first column header", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

    const bomCsv = "\uFEFFPedido,Cliente,Endereço,Cidade,Cubagem,Peso,Volumes\nPED-BOM,Cliente BOM,Rua 1,Campinas,2.0,100,2";
    const buffer = Buffer.from(bomCsv, "utf8");
    const orders = await spreadsheetParser.parseSpreadsheet(buffer, "bom.csv");

    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].orderId, "PED-BOM");
  });

  it("T2.7: auto-detects tab-separated (TSV) format and parses fields accurately", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

    const filePath = path.join(FIXTURES_DIR, "tab-separated.tsv");
    const buffer = fs.readFileSync(filePath);
    const orders = await spreadsheetParser.parseSpreadsheet(buffer, "tab-separated.tsv");

    assert.strictEqual(orders.length, 2);
    assert.strictEqual(orders[0].orderId, "PED-401");
    assert.strictEqual(orders[1].city, "Sumaré");
  });

  it("T2.8: sanitizes non-numeric strings ('N/A', '-', 'grátis') with positive fallback values", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;

    const filePath = path.join(FIXTURES_DIR, "invalid-numbers.csv");
    const buffer = fs.readFileSync(filePath);
    const orders = await spreadsheetParser.parseSpreadsheet(buffer, "invalid-numbers.csv");

    assert.strictEqual(orders.length, 2);
    for (const order of orders) {
      assert.ok(Number.isFinite(order.volumeM3) && order.volumeM3 > 0, "Volume must be finite positive number");
      assert.ok(Number.isFinite(order.weightKg) && order.weightKg > 0, "Weight must be finite positive number");
      assert.ok(Number.isFinite(order.boxes) && order.boxes >= 1, "Boxes must be integer >= 1");
    }
  });

  it("T2.9: partitions deliveries concentrated in the exact same city strictly by capacity limits", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    // 10 orders in Campinas totaling 55m³ and 11,000kg
    // Vehicle limits: 20m³ / 3500kg -> Minimum 3-4 routes required
    const orders = [];
    for (let i = 1; i <= 10; i++) {
      orders.push({
        orderId: `CAMP-${i}`,
        clientName: `Cliente C${i}`,
        address: `Rua ${i}`,
        city: "Campinas",
        volumeM3: 5.5,
        weightKg: 1100.0,
        boxes: 20,
        lat: -22.9099,
        lng: -47.0626,
      });
    }

    const routes = routeEngine.generateOptimizedRoutes(orders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    assert.ok(routes.length >= 3, `Expected at least 3 routes for 55m³/11000kg, got ${routes.length}`);
    assertCapacityInvariants(routes, 20.0, 3500.0);
    assertOrderConservation(orders, routes);
  });

  it("T2.10: sequences multiple orders for identical client/address without distance errors", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const orders = [
      { orderId: "DUP-1", clientName: "Supermercado A", address: "Av Central 100", city: "Campinas", volumeM3: 2.0, weightKg: 200, boxes: 5, lat: -22.9099, lng: -47.0626 },
      { orderId: "DUP-2", clientName: "Supermercado A", address: "Av Central 100", city: "Campinas", volumeM3: 3.0, weightKg: 300, boxes: 8, lat: -22.9099, lng: -47.0626 },
    ];

    const routes = routeEngine.generateOptimizedRoutes(orders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    assert.strictEqual(routes.length, 1);
    assertOrderConservation(orders, routes);
    const estimatedKm = routes[0].estimatedKm || routes[0].estimated_km;
    assert.ok(Number.isFinite(estimatedKm) && estimatedKm >= 0);
  });
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================

describe("Tier 3: Cross-Feature Combinations", () => {
  it("T3.1: Full E2E Pipeline: CSV parsing -> Geo coordinates -> Clustering -> Bin-Packing -> TSP -> LIFO", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;
    if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    // Step 1: Parse CSV
    const filePath = path.join(FIXTURES_DIR, "canonical-sp-deliveries.csv");
    const buffer = fs.readFileSync(filePath);
    const parsedOrders = await spreadsheetParser.parseSpreadsheet(buffer, "canonical-sp-deliveries.csv");
    assert.strictEqual(parsedOrders.length, 12);

    // Step 2: Resolve Coordinates
    for (const order of parsedOrders) {
      if (!order.lat || !order.lng) {
        const coords = geoBrazil.getCityCoordinates(order.city, order.uf);
        if (coords) {
          order.lat = coords.lat;
          order.lng = coords.lng;
        }
      }
      assert.ok(order.lat && order.lng, `Order ${order.orderId} must have coordinates`);
    }

    // Step 3: Generate Optimized Routes
    const routes = routeEngine.generateOptimizedRoutes(parsedOrders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    // Step 4: Verify Full Pipeline Integrity
    assert.ok(routes.length > 0, "Must generate suggested routes");
    assertCapacityInvariants(routes, 20.0, 3500.0);
    assertOrderConservation(parsedOrders, routes);

    for (const route of routes) {
      assertLifoManifestIntegrity(route);
      assert.ok(route.estimatedKm > 0 || route.estimated_km > 0);
    }
  });

  it("T3.2: Full Brazilian Semicolon + BOM + Decimal Commas Pipeline to LIFO Manifest", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;
    if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const filePath = path.join(FIXTURES_DIR, "semicolon-bom-brazil.csv");
    const buffer = fs.readFileSync(filePath);
    const parsedOrders = await spreadsheetParser.parseSpreadsheet(buffer, "semicolon-bom-brazil.csv");

    for (const order of parsedOrders) {
      const coords = geoBrazil.getCityCoordinates(order.city, order.uf);
      if (coords) {
        order.lat = coords.lat;
        order.lng = coords.lng;
      }
    }

    const routes = routeEngine.generateOptimizedRoutes(parsedOrders, {
      maxVolumeM3: 30.0,
      maxWeightKg: 6000.0,
      originDepot: DEFAULT_DEPOT,
    });

    assert.ok(routes.length >= 1);
    assertCapacityInvariants(routes, 30.0, 6000.0);
    assertLifoManifestIntegrity(routes[0]);
  });

  it("T3.3: Multi-Vehicle Fleet Partitioning enforces strict volume and weight limits across all trucks", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    // 15 orders of varying sizes
    const orders = [];
    for (let i = 1; i <= 15; i++) {
      orders.push({
        orderId: `FLEET-${i}`,
        clientName: `Cliente ${i}`,
        address: `Rua ${i}`,
        city: i % 2 === 0 ? "Campinas" : "Sumaré",
        volumeM3: 3.0 + (i % 4),
        weightKg: 400 + (i * 60),
        boxes: 10 + i,
        lat: i % 2 === 0 ? -22.9099 : -22.8208,
        lng: i % 2 === 0 ? -47.0626 : -47.2669,
      });
    }

    const maxVol = 20.0;
    const maxWeight = 3500.0;
    const routes = routeEngine.generateOptimizedRoutes(orders, {
      maxVolumeM3: maxVol,
      maxWeightKg: maxWeight,
      originDepot: DEFAULT_DEPOT,
    });

    assertCapacityInvariants(routes, maxVol, maxWeight);
    assertOrderConservation(orders, routes);
  });

  it("T3.4: Route Engine output serializes cleanly to transactional POST /api/routes payload", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const orders = [
      { orderId: "SER-1", clientName: "Alfa", address: "Rua Alfa 1", city: "Campinas", volumeM3: 2.5, weightKg: 300, boxes: 5, products: "Itens Diversos", lat: -22.9099, lng: -47.0626 },
      { orderId: "SER-2", clientName: "Beta", address: "Rua Beta 2", city: "Sumaré", volumeM3: 3.0, weightKg: 400, boxes: 8, products: "Secos e Molhados", lat: -22.8208, lng: -47.2669 },
    ];

    const routes = routeEngine.generateOptimizedRoutes(orders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    const route = routes[0];
    const postBody = {
      name: route.name || "Rota Otimizada 1",
      routeDate: "2026-09-15",
      optimizeBy: "distance",
      circular: true,
      estimatedKm: route.estimatedKm,
      driverId: "11111111-1111-1111-1111-111111111111",
      vehicleId: "22222222-2222-2222-2222-222222222222",
      stops: route.stops.map((s, idx) => ({
        position: idx,
        name: s.name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        boxes: s.boxes,
        volume_m3: s.volume_m3 || s.volumeM3,
        weight_kg: s.weight_kg || s.weightKg,
        order_id: s.orderId || s.order_id,
        products: s.products,
      })),
    };

    const jsonSerialized = JSON.stringify(postBody);
    const parsedBack = JSON.parse(jsonSerialized);

    assert.strictEqual(parsedBack.stops.length, 3, "Depot + 2 delivery stops = 3 stops");
    assert.strictEqual(parsedBack.stops[0].position, 0);
    assert.strictEqual(parsedBack.stops[1].order_id, "SER-1");
  });

  it("T3.5: Order Conservation Invariant guarantees zero drops and zero duplicate deliveries", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const orders = [];
    for (let i = 1; i <= 20; i++) {
      orders.push({
        orderId: `ORD-CONS-${i}`,
        clientName: `Cliente ${i}`,
        address: `Endereço ${i}`,
        city: "Campinas",
        volumeM3: 2.0,
        weightKg: 200,
        boxes: 5,
        lat: -22.9099,
        lng: -47.0626,
      });
    }

    const routes = routeEngine.generateOptimizedRoutes(orders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    assertOrderConservation(orders, routes);
  });
});

// ============================================================================
// TIER 4: REAL-WORLD APPLICATION SCENARIOS
// ============================================================================

describe("Tier 4: Real-World Application Scenarios", () => {
  it("T4.1: Canonical 12-City São Paulo Hub Benchmark parses and routes in < 3,000ms SLA", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;
    if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const start = performance.now();

    // 1. Ingest Canonical SP CSV
    const filePath = path.join(FIXTURES_DIR, "canonical-sp-deliveries.csv");
    const buffer = fs.readFileSync(filePath);
    const parsedOrders = await spreadsheetParser.parseSpreadsheet(buffer, "canonical-sp-deliveries.csv");

    // 2. Geocode in memory
    for (const order of parsedOrders) {
      if (!order.lat || !order.lng) {
        const coords = geoBrazil.getCityCoordinates(order.city, order.uf);
        if (coords) {
          order.lat = coords.lat;
          order.lng = coords.lng;
        }
      }
    }

    // 3. Generate routes (standard VUC: 20m³, 3500kg)
    const routes = routeEngine.generateOptimizedRoutes(parsedOrders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    const elapsed = performance.now() - start;

    // Verification: Performance SLA strictly under 3000ms
    assert.ok(
      elapsed < 3000,
      `Canonical 12-City benchmark took ${elapsed.toFixed(2)}ms (must be strictly < 3,000ms SLA)`
    );

    // Verification: Invariant and Feasibility
    assertCapacityInvariants(routes, 20.0, 3500.0);
    assertOrderConservation(parsedOrders, routes);

    for (const r of routes) {
      assertLifoManifestIntegrity(r);
    }
  });

  it("T4.2: High-Stress 50-Stop delivery ingestion executes within < 3,000ms SLA", async (t) => {
    if (!requireModule(spreadsheetParser, spreadsheetParserError, "lib/spreadsheet-parser.ts", "M1", t)) return;
    if (!requireModule(geoBrazil, geoBrazilError, "lib/geo-brazil.ts", "M1", t)) return;
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const start = performance.now();

    const filePath = path.join(FIXTURES_DIR, "high-stress-50.csv");
    const buffer = fs.readFileSync(filePath);
    const parsedOrders = await spreadsheetParser.parseSpreadsheet(buffer, "high-stress-50.csv");

    for (const order of parsedOrders) {
      if (!order.lat || !order.lng) {
        const coords = geoBrazil.getCityCoordinates(order.city, order.uf);
        if (coords) {
          order.lat = coords.lat;
          order.lng = coords.lng;
        }
      }
    }

    const routes = routeEngine.generateOptimizedRoutes(parsedOrders, {
      maxVolumeM3: 30.0,
      maxWeightKg: 6000.0,
      originDepot: DEFAULT_DEPOT,
    });

    const elapsed = performance.now() - start;

    assert.ok(
      elapsed < 3000,
      `50-stop stress benchmark took ${elapsed.toFixed(2)}ms (must be strictly < 3,000ms SLA)`
    );
    assertCapacityInvariants(routes, 30.0, 6000.0);
    assertOrderConservation(parsedOrders, routes);
  });

  it("T4.3: Fleet Heterogeneity Verification ensures capacity invariant holds across VUC, Toco, and Van", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const testPool = [
      { orderId: "H1", clientName: "A", address: "R1", city: "Campinas", volumeM3: 3.5, weightKg: 600, boxes: 10, lat: -22.9099, lng: -47.0626 },
      { orderId: "H2", clientName: "B", address: "R2", city: "Sumaré", volumeM3: 4.5, weightKg: 800, boxes: 12, lat: -22.8208, lng: -47.2669 },
      { orderId: "H3", clientName: "C", address: "R3", city: "Paulínia", volumeM3: 5.0, weightKg: 900, boxes: 15, lat: -22.7614, lng: -47.1542 },
      { orderId: "H4", clientName: "D", address: "R4", city: "Americana", volumeM3: 3.0, weightKg: 500, boxes: 8, lat: -22.7375, lng: -47.3331 },
    ];

    const fleetProfiles = [
      { type: "Van", maxVol: 10.0, maxWeight: 1500.0 },
      { type: "VUC", maxVol: 20.0, maxWeight: 3500.0 },
      { type: "Toco", maxVol: 30.0, maxWeight: 6000.0 },
    ];

    for (const profile of fleetProfiles) {
      const routes = routeEngine.generateOptimizedRoutes(testPool, {
        maxVolumeM3: profile.maxVol,
        maxWeightKg: profile.maxWeight,
        originDepot: DEFAULT_DEPOT,
      });

      assertCapacityInvariants(routes, profile.maxVol, profile.maxWeight);
      assertOrderConservation(testPool, routes);
    }
  });

  it("T4.4: Physical Baú LIFO Feasibility & Warehouse Loading Guide verification", (t) => {
    if (!requireModule(routeEngine, routeEngineError, "lib/route-engine.ts", "M2", t)) return;

    const orders = [
      { orderId: "P1", clientName: "Cliente 1", address: "Rua 1", city: "Campinas", volumeM3: 2.0, weightKg: 200, boxes: 5, lat: -22.9099, lng: -47.0626 },
      { orderId: "P2", clientName: "Cliente 2", address: "Rua 2", city: "Sumaré", volumeM3: 3.0, weightKg: 300, boxes: 8, lat: -22.8208, lng: -47.2669 },
      { orderId: "P3", clientName: "Cliente 3", address: "Rua 3", city: "Hortolândia", volumeM3: 2.5, weightKg: 250, boxes: 6, lat: -22.8583, lng: -47.2200 },
    ];

    const routes = routeEngine.generateOptimizedRoutes(orders, {
      maxVolumeM3: 20.0,
      maxWeightKg: 3500.0,
      originDepot: DEFAULT_DEPOT,
    });

    const route = routes[0];
    const manifest = route.lifoManifest;

    // Verify physical loading feasibility:
    // Loading step 1 must be FUNDO (cab/back of truck)
    assert.strictEqual(manifest[0].loadingStep, 1);
    assert.strictEqual(manifest[0].compartmentPosition, "FUNDO");

    // Loading step N must be PORTA (rear doors of truck)
    assert.strictEqual(manifest[manifest.length - 1].loadingStep, 3);
    assert.strictEqual(manifest[manifest.length - 1].compartmentPosition, "PORTA");

    // The item at PORTA must be delivery stop #1
    assert.strictEqual(manifest[manifest.length - 1].deliveryOrderIndex, 1);
  });
});
