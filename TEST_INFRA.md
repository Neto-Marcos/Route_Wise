# Automated Routing Engine: Test Infrastructure & E2E Testing Architecture

**Project**: Criar Rota TMS — Automated Routing Engine  
**Test Framework**: Node.js Native Test Runner (`node:test` & `node:assert/strict`)  
**Target Environment**: Node.js v24.x, TypeScript Native, ES Modules  
**Primary Suite**: `tests/e2e-routing.test.mjs`  
**Author**: E2E Test Writer  
**Status**: ACTIVE / TEST READY  

---

## 1. Executive Summary & Testing Philosophy

The Criar Rota TMS Automated Routing Engine is a mission-critical logistics system responsible for ingesting dispatch manifests, resolving Brazilian geography, partitioning cargo across vehicle fleets, optimizing delivery sequences, and producing warehouse loading orders.

This test infrastructure implements an **opaque-box, requirements-driven testing architecture** adhering to the project's **4-Tier Testing Methodology**:
- **Tier 1: Feature Coverage** (>= 5 tests per core feature across all functional requirements).
- **Tier 2: Boundary & Corner Cases** (BOM, semicolons, empty inputs, oversized cargo, invalid text numbers, duplicate locations).
- **Tier 3: Cross-Feature Combinations** (Full E2E ingestion-to-dispatch pipelines, multi-vehicle partitioning, transaction formatting).
- **Tier 4: Real-World Application Scenarios** (12-stop São Paulo benchmark, 50-stop stress tests, <3s SLA verification, mathematical invariants).

---

## 2. Test Architecture & Module Boundaries

The test suite interacts strictly through public interfaces specified in `PROJECT.md` and technical specifications (`spec_routing_engine.md`):

```
                                  ┌────────────────────────────────┐
                                  │      Test Runner (Native)      │
                                  │ node --test tests/e2e-routing  │
                                  └──────────────┬─────────────────┘
                                                 │
                  ┌──────────────────────────────┼──────────────────────────────┐
                  ▼                              ▼                              ▼
    ┌───────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────────┐
    │ lib/spreadsheet-parser.ts │  │     lib/geo-brazil.ts     │  │    lib/route-engine.ts    │
    ├───────────────────────────┤  ├───────────────────────────┤  ├───────────────────────────┤
    │ parseSpreadsheet(buf, fn) │  │ getCityCoordinates(c, uf) │  │ generateOptimizedRoutes() │
    │ Delimiter auto-detection  │  │ calculateHaversineDistance│  │ Bin-packing (m³ & kg)     │
    │ UTF-8 BOM sanitization    │  │ normalizeCityName()       │  │ Spatial Clustering        │
    │ Brazilian decimals/units  │  │ Sub-5ms in-memory cache   │  │ LIFO Manifest Guide       │
    └─────────────┬─────────────┘  └─────────────┬─────────────┘  │ TSP Nearest Neighbor/2Opt │
                  │                              │                └─────────────┬─────────────┘
                  └──────────────────────────────┼──────────────────────────────┘
                                                 │
                                                 ▼
                                  ┌───────────────────────────┐
                                  │  Database & API Contract  │
                                  │     POST /api/routes      │
                                  │ Transactional Persistence │
                                  └───────────────────────────┘
```

---

## 3. The 4-Tier Test Suite Specification

### Tier 1: Feature Coverage (>= 5 tests per feature)
Tier 1 ensures each isolated capability of the routing engine meets its specification independently:

1. **Universal Spreadsheet Parser (`lib/spreadsheet-parser.ts`)**
   - RFC 4180 parsing with standard comma delimiters.
   - Column normalization matching Brazilian TMS aliases (`Cliente`, `Endereço`, `Cidade`, `Cubagem`, `Peso`, `Volumes`).
   - Brazilian decimal number parsing (`1.250,50` $\rightarrow$ `1250.50`, `0,45 m³` $\rightarrow$ `0.45`).
   - Unit suffix stripping (`kg`, `m³`, `cx`, `volumes`).
   - Extraction of all mandatory order fields (`orderId`, `clientName`, `address`, `city`, `volumeM3`, `weightKg`, `boxes`).

2. **In-Memory Brazilian Geo Dictionary & Distance Utility (`lib/geo-brazil.ts`)**
   - Instant $O(1)$ coordinate resolution for key São Paulo logistics hubs (Campinas, Sumaré, Hortolândia, Paulínia, Americana, São Paulo, Jundiaí, etc.).
   - City name normalization (accent stripping, lowercase, punctuation removal, suffix handling e.g. `"Campinas - SP"`).
   - High-precision Haversine spherical distance calculation adhering to geodesic bounds ($R = 6371\text{ km}$).
   - Instant sub-5ms lookup performance without external network calls.
   - Graceful fallback for unrecognized or regional variations with approximate coordinates.

3. **Spatial Proximity & Geographic Clustering (`lib/route-engine.ts`)**
   - Proximity clustering grouping orders within operational neighborhood radii ($\le 35\text{ km}$).
   - Separation of geographically disjoint deliveries (e.g. Campinas vs Ribeirão Preto) into distinct clusters.
   - Preservation of complete order metadata through clustering partitions.
   - Deterministic clustering behavior regardless of input order sequence.
   - Correct centroid and neighborhood graph calculations.

4. **Multi-Dimensional Bin-Packing & Mathematical Capacity Invariants (`lib/route-engine.ts`)**
   - Multi-dimensional constraints simultaneously respecting maximum volume ($m^3$) AND maximum weight ($kg$).
   - Cluster splitting when volume threshold is exceeded (e.g. 55 $m^3$ partitioned across 20 $m^3$ vehicles).
   - Cluster splitting when weight threshold is exceeded (e.g. 11,000 $kg$ partitioned across 3,500 $kg$ vehicles).
   - Mathematical Invariant Assertion: $\forall R_j, \sum v_i \le V_{\max} + \epsilon$ and $\sum w_i \le W_{\max} + \epsilon$.
   - Fleet flexibility across distinct vehicle classes (VUC 20m³/3500kg, Toco 30m³/6000kg, Van 10m³/1500kg).

5. **LIFO Loading Order Manifest Generation (`lib/route-engine.ts`)**
   - Strict inversion of delivery sequence to produce warehouse loading instructions.
   - Last delivery assigned loading step #1 with compartment position `"FUNDO"`.
   - First delivery assigned loading step #N with compartment position `"PORTA"`.
   - Intermediate delivery stops assigned compartment position `"MEIO"`.
   - Loading steps strictly indexed $1 \dots N$ with delivery index counting down $N \dots 1$.
   - Preservation of stop metadata (`boxes`, `volumeM3`, `weightKg`, `orderId`, `address`).

6. **Route Sequencing (TSP Nearest Neighbor + 2-Opt) (`lib/route-engine.ts`)**
   - Position 0 assigned to Origin Depot (Distribution Center / Garage).
   - Delivery sequence sorted by nearest-neighbor distance minimizing total travel kilometers.
   - Estimated kilometers calculated accurately over geodesic distance steps.
   - Non-origin stops indexed sequentially from position 1 to $N$.
   - Elimination of crossing paths and erratic back-and-forth travel.

7. **Dispatch API Schema & Persistence Integration Contract**
   - Output of `generateOptimizedRoutes` conforms to `POST /api/routes` input schema.
   - Status transitions to `'assigned'` when driver and vehicle are selected.
   - Transactional integrity guarantees for route header and stops.
   - Driver PWA retrieval contract validation (`GET /api/routes/[id]` with `weight_kg` and `order_id`).

---

### Tier 2: Boundary & Corner Cases
Adversarial and extreme edge scenarios designed to break naïve implementations:

- **Empty Spreadsheet**: 0-byte file or empty buffer returns empty list or rejects cleanly with HTTP 400.
- **Header-Only Spreadsheet**: Valid headers but 0 data rows handles cleanly without throwing `IndexOutOfBounds`.
- **Single-Stop Delivery**: Route with exactly 1 customer; LIFO manifest handles single stop safely (`"PORTA"` / `"FUNDO"`).
- **Oversized Single Order**: An individual order exceeding vehicle volume (e.g. 35 $m^3$ for a 30 $m^3$ truck) or weight (7500 $kg$ for 6000 $kg$) triggers dedicated handling or clear violation error without corrupting normal routes.
- **Brazilian Semicolon Delimited CSV**: CSV using `;` delimiter and `,` decimal points (standard Microsoft Excel export in Brazil) parses with 100% column fidelity.
- **UTF-8 Byte Order Mark (BOM)**: File starting with `\uFEFF` (`ef bb bf`) cleans the BOM before matching the first column header.
- **Tab-Separated TSV**: Auto-detects `\t` delimiter.
- **Malformed / Non-Numeric Values**: Strings like `"N/A"`, `"-"`, `"grátis"`, negative numbers, or `NaN` sanitized with safe positive defaults.
- **Single-City Concentrated Deliveries**: All orders in Campinas partitioned strictly by volume/weight limits.
- **Duplicate Addresses**: Multiple orders for the same client/location sequenced consecutively without zero-distance division errors.

---

### Tier 3: Cross-Feature Combinations
Multi-module end-to-end pipelines testing data flow across the entire system:

1. **Full CSV Ingestion Pipeline**:
   $$\text{Raw CSV} \longrightarrow \text{Parser} \longrightarrow \text{Geo Lookup} \longrightarrow \text{Clustering} \longrightarrow \text{Bin-Packing} \longrightarrow \text{TSP} \longrightarrow \text{LIFO Manifest}$$
2. **Brazilian Semicolon + BOM Pipeline**:
   End-to-end ingestion and routing of native Brazilian enterprise spreadsheet formats.
3. **Multi-Vehicle Fleet Partitioning**:
   Mixed delivery pool dynamically partitioned into heterogeneous vehicles with strict mathematical invariants.
4. **Dispatch Serialization Pipeline**:
   Route Engine output mapped to transactional `POST /api/routes` database payload.
5. **Order Conservation & Zero-Leakage Invariant**:
   $$\sum \text{Orders In} = \sum \text{Delivered Stops Out} \quad (\text{No drops, no duplicates})$$

---

### Tier 4: Real-World Application Scenarios
High-fidelity production simulation and SLA benchmarking:

1. **Canonical 12-City São Paulo Hub Benchmark**:
   - 12 real municipalities in the São Paulo logistics corridor (Campinas, Sumaré, Hortolândia, Paulínia, Americana, Santa Bárbara d'Oeste, Valinhos, Vinhedo, Indaiatuba, Jundiaí, São Paulo, Guarulhos).
   - **SLA Performance Requirement**: Entire end-to-end execution completes in **strictly < 3,000 ms** (typically < 100 ms).
   - **Mathematical Capacity Invariant**: Verification that $\sum v_i \le V_{\max}$ and $\sum w_i \le W_{\max}$ on all generated routes.
2. **High-Stress 50-Stop Delivery Ingestion**:
   - 50 delivery orders ingested simultaneously.
   - Execution time measured and benchmarked against SLA.
   - Total stops and order integrity verified.
3. **Fleet Heterogeneity Verification**:
   - Testing against VUC ($20\text{ m}^3 / 3500\text{ kg}$), Toco ($30\text{ m}^3 / 6000\text{ kg}$), and Van ($10\text{ m}^3 / 1500\text{ kg}$).
4. **Physical Baú LIFO Feasibility**:
   - Verifying warehouse loading guide feasibility against physical truck constraints.

---

## 4. Test Fixtures Inventory

Located in `tests/fixtures/`:

| Fixture File | Description | Edge / Test Case |
| :--- | :--- | :--- |
| `canonical-sp-deliveries.csv` | 12 real delivery orders in SP logistics corridor | Tier 1, Tier 3, Tier 4 benchmark |
| `semicolon-bom-brazil.csv` | Semicolon (`;`) delimiter, UTF-8 BOM, decimal commas | Tier 2 Brazilian format robustness |
| `empty-deliveries.csv` | 0-byte completely empty file | Tier 2 Empty file handling |
| `header-only.csv` | Valid headers with zero data rows | Tier 2 Zero-row robustness |
| `invalid-numbers.csv` | Text strings in numeric fields (`"N/A"`, `"-"`, `"grátis"`) | Tier 2 Numeric sanitization |
| `oversized-single-stop.csv` | Single order of 35 $m^3$ / 7500 $kg$ | Tier 2 Vehicle capacity overflow |
| `single-stop.csv` | Exactly 1 customer delivery | Tier 2 Minimal route / single LIFO |
| `tab-separated.tsv` | Tab-delimited TSV file | Tier 2 TSV auto-detection |
| `same-city-high-volume.csv` | 10 orders in Campinas (55 $m^3$ / 11,000 $kg$) | Tier 2 Capacity splitting within city |
| `high-stress-50.csv` | 50 real orders across 15 SP cities | Tier 4 Stress and SLA testing |

---

## 5. Expected Output Derivation & Mathematical Oracles

Every test assertion is grounded in explicit mathematical properties or reference oracles:

1. **Haversine Distance Geodesic Oracle**:
   $$d = 2 R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
   Where $R = 6371\text{ km}$. Test oracle verifies that calculated distances match mathematical geodesic distances within $\pm 0.5\text{ km}$.
2. **Conservation of Mass / Cargo Invariant**:
   $$\sum_{r \in \text{Routes}} \text{stops}(r) = |\text{Orders}|$$
   $$\forall \text{order} \in \text{Orders}: \exists! \, \text{stop} \in \text{Routes} \text{ with } \text{stop.orderId} = \text{order.orderId}$$
3. **Capacity Invariant**:
   $$\forall r \in \text{Routes}: \left( \sum_{s \in r} s.\text{volume\_m3} \le V_{\max} \right) \land \left( \sum_{s \in r} s.\text{weight\_kg} \le W_{\max} \right)$$
4. **LIFO Stepwise Reversal Invariant**:
   $$\text{loadingStep}(i) = i \iff \text{deliveryOrderIndex} = N - i + 1$$
   $$\text{step } 1 = \text{"FUNDO"}, \quad \text{step } N = \text{"PORTA"}, \quad 1 < \text{step} < N = \text{"MEIO"}$$
5. **Performance SLA Oracle**:
   $$T_{\text{end}} - T_{\text{start}} < 3000\text{ ms}$$

---

## 6. Progressive Testability Architecture

During multi-milestone development, the test suite supports **progressive testability**:
- Uses dynamic `import()` to inspect module presence (`lib/spreadsheet-parser.ts`, `lib/geo-brazil.ts`, `lib/route-engine.ts`).
- If an implementation milestone has not yet been delivered by an implementer, individual tests gracefully mark `t.skip("Milestone M... not yet implemented")` rather than causing unhandled runtime crashes.
- If a syntax error or genuine bug occurs in an existing module, the test runner immediately fails and escalates the defect.
- When all milestones are complete, 100% of tests run and pass without skips.

---

## 7. How to Execute the Test Suite

Run using the Node.js native test runner:

```bash
# Execute the complete automated routing E2E suite
node --test tests/e2e-routing.test.mjs

# Execute all project test suites (including offline queue)
node --test tests/*.test.mjs
```
