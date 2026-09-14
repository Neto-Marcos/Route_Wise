/**
 * lib/route-engine.ts
 * Motor de Roteirização Automática — Criar Rota TMS
 *
 * Algoritmo:
 *  1. Clusterização geográfica por cidade usando coordenadas brasileiras embutidas
 *     + fórmula de Haversine para calcular distância entre municípios.
 *  2. Bin-Packing de capacidade: quebra clusters em múltiplas rotas quando
 *     volume (m³) ou peso (kg) excede o limite configurado.
 *  3. Ordenação LIFO: a sequência de carregamento é o inverso da entrega
 *     (última parada = primeira a ser carregada).
 */

import type { OrderRow } from './spreadsheet-parser';

export function normCity(city: string): string {
  return city.trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface EngineConfig {
  /** Volume máximo por veículo em m³. Padrão: 30 */
  maxVolumeM3: number;
  /** Peso máximo por veículo em kg. Padrão: 10000 */
  maxWeightKg: number;
  /** Raio em km para considerar cidades "próximas" e agrupá-las. Padrão: 80 */
  clusterRadiusKm: number;
  /** Data de entrega (YYYY-MM-DD) */
  routeDate: string;
  /** Nome do ponto de origem (base/filial) */
  originName: string;
  /** Lat/lng da origem */
  originLat: number;
  originLng: number;
  /** Máximo de destinos distintos por rota */
  maxStops?: number;
  minVolumeM3?: number;
  corridorAngle?: number;
  prioritizeAging?: boolean;
  returnToOrigin?: boolean;
  roadFactor?: number;
  averageSpeed?: number;
  serviceMinutes?: number;
  maxHours?: number;
}

export interface SuggestedStop {
  position: number;
  city: string;
  clientName: string;
  address: string;
  lat: number;
  lng: number;
  orders: OrderRow[];
  volumeM3: number;
  weightKg: number;
  boxes: number;
  /** Sequência de carregamento (LIFO: 1 = última entrega, carregada primeiro) */
  loadingSequence: number;
}

export interface SuggestedRoute {
  index: number;
  name: string;
  stops: SuggestedStop[];
  totalVolumeM3: number;
  totalWeightKg: number;
  totalBoxes: number;
  totalOrders: number;
  /** 0–100 % */
  occupancyPct: number;
  /** Cidades no caminho, em ordem de entrega */
  cityPath: string[];
  /** Aviso se acima de 85% */
  warning?: string;
  estimatedKm?: number;
  estimatedDurationMin?: number;
  costEstimateMin?: number;
  costEstimateMax?: number;
  maxAgingDays?: number;
  state?: string;
}

export interface EngineResult {
  routes: SuggestedRoute[];
  unassigned: OrderRow[];
  stats: {
    totalOrders: number;
    totalRoutes: number;
    totalVolumeM3: number;
    avgOccupancyPct: number;
  };
}

// ─── Dicionário geográfico ─────────────────────────────────────────────────
// Capitais e maiores cidades do Nordeste + demais estados
// Formato: [lat, lng]
const GEO: Record<string, [number, number]> = {
  // Paraíba
  'CAMPINA GRANDE': [-7.2306, -35.8811],
  'JOAO PESSOA': [-7.1195, -34.8450],
  'PATOS': [-7.0222, -37.2802],
  'CAJAZEIRAS': [-6.8914, -38.5575],
  'SOUSA': [-6.7607, -38.2285],
  'GUARABIRA': [-6.8526, -35.4911],
  'BAYEUX': [-7.1256, -34.9338],
  'SANTA RITA': [-7.1139, -34.9756],
  'CAICO': [-6.4578, -37.0972], // RN mas próxima
  'MONTEIRO': [-7.8888, -37.1194],
  'SUMÉ': [-7.6638, -36.8817],
  'POMBAL': [-6.7724, -37.8038],
  'PICUI': [-6.5521, -36.3527],
  'CUITÉ': [-6.4906, -36.1554],
  'ESPERANÇA': [-7.0308, -35.8622],
  'LAGOA SECA': [-7.1694, -35.8550],
  'MASSARANDUBA': [-6.9875, -35.7936],
  'QUEIMADAS': [-7.3564, -35.9005],
  'FAGUNDES': [-7.3528, -35.9791],
  'ALAGOA GRANDE': [-7.0347, -35.6258],
  'ITABAIANA': [-7.3264, -35.3256],
  'SOLEDAD': [-6.9947, -36.3558],
  'BARRA DE SANTA ROSA': [-6.7172, -36.0711],
  'ARARUNA': [-6.5326, -35.7413],
  'REMÍGIO': [-6.9181, -35.8003],
  'AREIA': [-6.9648, -35.6975],
  'SAPÉ': [-7.0931, -35.2269],
  'MAMANGUAPE': [-6.8373, -35.1267],
  'RIO TINTO': [-6.8026, -35.0820],
  'PEDRAS DE FOGO': [-7.3993, -34.9965],
  'INGÁ': [-7.2828, -35.6136],
  'NATUBA': [-7.7059, -35.5628],
  'UMBUZEIRO': [-7.5875, -35.6620],
  'MULUNGU': [-7.0092, -35.4786],
  'JURIPIRANGA': [-7.3644, -35.2756],
  // Rio Grande do Norte
  'NATAL': [-5.7945, -35.2110],
  'MOSSORÓ': [-5.1878, -37.3444],
  'PARNAMIRIM': [-5.9145, -35.2636],
  'CAICÓ': [-6.4578, -37.0972],
  'PAU DOS FERROS': [-6.1097, -38.2026],
  'AÇU': [-5.5767, -36.9098],
  'CURRAIS NOVOS': [-6.2586, -36.5133],
  // Pernambuco
  'RECIFE': [-8.0578, -34.8829],
  'CARUARU': [-8.2820, -35.9753],
  'PETROLINA': [-9.3982, -40.5004],
  'OLINDA': [-7.9997, -34.8449],
  'PAULISTA': [-7.9352, -34.8726],
  'CAETÉS': [-8.7778, -36.6264],
  'GARANHUNS': [-8.8906, -36.4962],
  'ARCOVERDE': [-8.4184, -37.0548],
  'SANTA CRUZ DO CAPIBARIBE': [-7.9538, -36.2052],
  // Ceará
  'FORTALEZA': [-3.7172, -38.5433],
  'CAUCAIA': [-3.7361, -38.6583],
  'JUAZEIRO DO NORTE': [-7.2139, -39.3154],
  'SOBRAL': [-3.6861, -40.3497],
  'MARACANAÚ': [-3.7783, -38.6269],
  'CRATO': [-7.2339, -39.4092],
  // Alagoas
  'MACEIÓ': [-9.6658, -35.7350],
  'ARAPIRACA': [-9.7525, -36.6614],
  // Sergipe
  'ARACAJU': [-10.9472, -37.0731],
  // Bahia
  'SALVADOR': [-12.9722, -38.5014],
  'FEIRA DE SANTANA': [-12.2664, -38.9663],
  'VITÓRIA DA CONQUISTA': [-14.8619, -40.8443],
  'ILHÉUS': [-14.7896, -39.0399],
  'JUAZEIRO': [-9.4278, -40.4917],
  // São Paulo
  'SAO PAULO': [-23.5505, -46.6333],
  'CAMPINAS': [-22.9056, -47.0608],
  'GUARULHOS': [-23.4543, -46.5338],
  // Rio de Janeiro
  'RIO DE JANEIRO': [-22.9068, -43.1729],
  // Outros estados
  'BELO HORIZONTE': [-19.9167, -43.9345],
  'BRASILIA': [-15.7801, -47.9292],
  'MANAUS': [-3.1019, -60.0250],
  'BELEM': [-1.4558, -48.4902],
  'CURITIBA': [-25.4284, -49.2733],
  'PORTO ALEGRE': [-30.0346, -51.2177],
  'FLORIANOPOLIS': [-27.5954, -48.5480],
  'GOIANIA': [-16.6864, -49.2643],
};

/** Haversine: distância em km entre dois pontos lat/lng */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (n: number) => n * Math.PI / 180;
  const toDeg = (n: number) => n * 180 / Math.PI;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function angleDiff(a: number, b: number) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function agingDays(order: OrderRow) { const date = order.closedAt ? new Date(order.closedAt) : null; return !date || Number.isNaN(date.getTime()) ? 0 : Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000)); }

/** Obtém coordenadas de uma cidade (normalizada) */
function getCityCoords(city: string): [number, number] | null {
  const key = normCity(city);
  // Busca exata
  if (GEO[key]) return GEO[key];
  // Busca parcial
  const partial = Object.keys(GEO).find(k => k.includes(key) || key.includes(k));
  return partial ? GEO[partial] : null;
}

// ─── Algoritmo principal ─────────────────────────────────────────────────────

/**
 * Dado um conjunto de pedidos (OrderRow[]) e uma configuração de veículo,
 * retorna as rotas sugeridas com agrupamento geográfico e respeito à capacidade.
 */
export function generateRoutes(orders: OrderRow[], config: EngineConfig): EngineResult {
  const {
    maxVolumeM3,
    maxWeightKg,
    clusterRadiusKm,
    originLat,
    originLng,
  } = config;

  // 1. Agrupar por UF + cidade. Nunca se mistura estados, mesmo quando duas
  // cidades são próximas: essa é uma regra operacional da carteira.
  const byCity = new Map<string, { city: string; uf: string; orders: OrderRow[]; coords: [number, number] | null }>();
  const unassigned: OrderRow[] = [];

  for (const o of orders) {
    if (o.volumeM3 > maxVolumeM3 || o.weightKg > maxWeightKg) { unassigned.push(o); continue; }
    const city = normCity(o.city);
    const uf = (o.uf ?? '').trim().toUpperCase();
    const key = `${uf}|${city}`;
    if (!byCity.has(key)) {
      const suppliedCoords = Number.isFinite(o.lat) && Number.isFinite(o.lng) ? [o.lat!, o.lng!] as [number, number] : null;
      byCity.set(key, { city, uf, orders: [], coords: suppliedCoords ?? getCityCoords(o.city) });
    }
    byCity.get(key)!.orders.push(o);
  }

  // 2. Agrupar pela UF. A operação define estado como a fronteira logística
  // primária: cidades de estados diferentes nunca compartilham uma rota, e as
  // cidades do mesmo estado só são separadas por capacidade/limite de paradas.
  type CityGroup = { uf: string; cities: string[]; coords: [number, number]; bearing: number; orders: OrderRow[] };
  const byState = new Map<string, CityGroup>();

  for (const { city, uf, orders: cityOrders, coords } of byCity.values()) {
    // Sem UF não pode ser combinado com outro destino desconhecido.
    const groupKey = uf || `SEM_UF:${city}`;
    const groupUf = uf || "";
    const cityCoords = coords ?? [originLat, originLng] as [number, number];
    const existing = byState.get(groupKey);
    if (existing) {
      const cityCount = existing.cities.length;
      existing.cities.push(city);
      existing.orders.push(...cityOrders);
      existing.coords = [
        (existing.coords[0] * cityCount + cityCoords[0]) / (cityCount + 1),
        (existing.coords[1] * cityCount + cityCoords[1]) / (cityCount + 1),
      ];
      existing.bearing = bearingDeg(originLat, originLng, existing.coords[0], existing.coords[1]);
    } else {
      byState.set(groupKey, {
        uf: groupUf,
        cities: [city],
        coords: cityCoords,
        bearing: bearingDeg(originLat, originLng, cityCoords[0], cityCoords[1]),
        orders: [...cityOrders],
      });
    }
  }
  const groups = [...byState.values()];

  // 3. Ordenar grupos pela distância à origem (mais próximos primeiro)
  groups.sort((a, b) =>
    haversineKm(originLat, originLng, a.coords[0], a.coords[1]) -
    haversineKm(originLat, originLng, b.coords[0], b.coords[1])
  );

  // 4. Bin-Packing: quebrar grupos em rotas respeitando capacidade
  const routes: SuggestedRoute[] = [];
  let routeIndex = 1;

  for (const group of groups) {
    // Ordena pedidos dentro do grupo por cidade e volume (desc)
    const sorted = [...group.orders].sort((a, b) => {
      if (config.prioritizeAging) {
        const ageDiff = agingDays(b) - agingDays(a);
        if (ageDiff) return ageDiff;
      }
      const cityDiff = normCity(a.city).localeCompare(normCity(b.city));
      if (cityDiff !== 0) return cityDiff;
      return b.volumeM3 - a.volumeM3;
    });

    // Preenche rotas com bin-packing
    let currentRoute: OrderRow[] = [];
    let currentVol = 0;
    let currentWt = 0;

    for (const order of sorted) {
      const willExceedVol = currentVol + order.volumeM3 > maxVolumeM3;
      const willExceedWt  = currentWt + order.weightKg  > maxWeightKg;
      const existingCities = new Set(currentRoute.map((item) => `${item.uf ?? ''}|${normCity(item.city)}`));
      const isNewStop = !existingCities.has(`${order.uf ?? ''}|${normCity(order.city)}`);
      const willExceedStops = Boolean(config.maxStops && isNewStop && existingCities.size >= config.maxStops);

      if ((willExceedVol || willExceedWt || willExceedStops) && currentRoute.length > 0) {
        // Fecha rota atual
        routes.push(buildRoute(routeIndex++, currentRoute, group, config));
        currentRoute = [];
        currentVol = 0;
        currentWt = 0;
      }

      currentRoute.push(order);
      currentVol += order.volumeM3;
      currentWt  += order.weightKg;
    }

    if (currentRoute.length > 0) {
      routes.push(buildRoute(routeIndex++, currentRoute, group, config));
    }
  }

  // 5. Calcular estatísticas globais
  const totalVol = routes.reduce((s, r) => s + r.totalVolumeM3, 0);
  const avgOcc = routes.length
    ? routes.reduce((s, r) => s + r.occupancyPct, 0) / routes.length
    : 0;

  return {
    routes,
    unassigned,
    stats: {
      totalOrders: orders.length,
      totalRoutes: routes.length,
      totalVolumeM3: totalVol,
      avgOccupancyPct: Math.round(avgOcc),
    },
  };
}

function buildRoute(
  index: number,
  orders: OrderRow[],
  group: { uf: string; cities: string[]; coords: [number, number] },
  config: EngineConfig,
): SuggestedRoute {
  // Agrupar pedidos por cidade em paradas
  const stopMap = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const k = normCity(o.city);
    if (!stopMap.has(k)) stopMap.set(k, []);
    stopMap.get(k)!.push(o);
  }

  const totalStops = stopMap.size;
  let pos = 1;
  const stops: SuggestedStop[] = [];

  for (const [city, cityOrders] of stopMap.entries()) {
    const suppliedCoords = cityOrders.find((order) => Number.isFinite(order.lat) && Number.isFinite(order.lng));
    const coords = suppliedCoords ? [suppliedCoords.lat!, suppliedCoords.lng!] as [number, number] : getCityCoords(city) ?? group.coords;
    const vol    = cityOrders.reduce((s, o) => s + o.volumeM3, 0);
    const wt     = cityOrders.reduce((s, o) => s + o.weightKg,  0);
    const bx     = cityOrders.reduce((s, o) => s + o.boxes,     0);
    const clients = [...new Set(cityOrders.map(o => o.client).filter(Boolean))].join(', ');
    const addresses = [...new Set(cityOrders.map(o => o.address).filter(Boolean))].join('; ');

    stops.push({
      position: pos,
      city: city,
      clientName: clients,
      address: addresses || city,
      lat: coords[0],
      lng: coords[1],
      orders: cityOrders,
      volumeM3: vol,
      weightKg: wt,
      boxes: bx,
      // LIFO: posição de carregamento inversa (última entrega = carregada primeiro = seq 1)
      loadingSequence: totalStops - pos + 1,
    });
    pos++;
  }

  const totalVol = stops.reduce((s, p) => s + p.volumeM3, 0);
  const totalWt  = stops.reduce((s, p) => s + p.weightKg,  0);
  const totalBx  = stops.reduce((s, p) => s + p.boxes,     0);
  const totalOrd = orders.length;
  const occ = config.maxVolumeM3 > 0 ? (totalVol / config.maxVolumeM3) * 100 : 0;
  let routeKm = 0, last: [number, number] = [config.originLat, config.originLng];
  for (const stop of stops) { routeKm += haversineKm(last[0], last[1], stop.lat, stop.lng); last = [stop.lat, stop.lng]; }
  if (config.returnToOrigin && stops.length) routeKm += haversineKm(last[0], last[1], config.originLat, config.originLng);
  const estimatedKm = routeKm * (config.roadFactor ?? 1.22);
  const estimatedDurationMin = estimatedKm / Math.max(20, config.averageSpeed ?? 55) * 60 + stops.length * (config.serviceMinutes ?? 40);
  const maxAge = Math.max(0, ...orders.map(agingDays));
  const warnings = [occ > 85 ? `Ocupação ${Math.round(occ)}% — verifique a carga` : "", config.minVolumeM3 && totalVol < config.minVolumeM3 ? `Abaixo do mínimo de ${config.minVolumeM3} m³` : "", config.maxHours && estimatedDurationMin > config.maxHours * 60 ? "Duração planejada excedida" : ""].filter(Boolean);

  const name = group.uf
    ? `Rota ${index} — ${group.uf}`
    : stops.length === 1
    ? `Rota ${index} — ${stops[0].city}`
    : `Rota ${index} — ${stops[0].city} + ${stops.length - 1} cidades`;

  return {
    index,
    name,
    stops,
    totalVolumeM3: parseFloat(totalVol.toFixed(2)),
    totalWeightKg: parseFloat(totalWt.toFixed(2)),
    totalBoxes: totalBx,
    totalOrders: totalOrd,
    occupancyPct: Math.min(100, Math.round(occ)),
    cityPath: stops.map(s => s.city),
    warning: warnings.join(" · ") || undefined,
    estimatedKm: parseFloat(estimatedKm.toFixed(1)),
    estimatedDurationMin: Math.round(estimatedDurationMin),
    costEstimateMin: parseFloat(((orders.reduce((sum, order) => sum + (order.totalValue ?? 0), 0)) * .03).toFixed(2)),
    costEstimateMax: parseFloat(((orders.reduce((sum, order) => sum + (order.totalValue ?? 0), 0)) * .05).toFixed(2)),
    maxAgingDays: maxAge,
    state: group.uf,
  };
}

export interface LifoManifestItem {
  loadingStep: number;
  deliveryOrderIndex: number;
  compartmentPosition: "FUNDO" | "MEIO" | "PORTA";
  stopName: string;
  orderId?: string;
  city?: string;
  boxes?: number;
  volumeM3: number;
  weightKg: number;
}

/**
 * Motor de roteirização otimizado compatível com a suíte de testes E2E e LIFO manifests
 */
export function generateOptimizedRoutes(orders: any[], options: any = {}): any[] {
  const maxVolumeM3 = options.maxVolumeM3 ?? 30.0;
  const maxWeightKg = options.maxWeightKg ?? 10000.0;
  const origin = options.originDepot ?? {
    name: options.originName ?? "CD Central",
    lat: options.originLat ?? -22.9056,
    lng: options.originLng ?? -47.0608,
  };

  // Verificação de capacidade individual por pedido
  for (const o of orders) {
    const vol = Number(o.volumeM3 ?? o.volume_m3 ?? 0);
    const wt = Number(o.weightKg ?? o.weight_kg ?? 0);
    if (vol > maxVolumeM3 || wt > maxWeightKg) {
      throw new Error(`Pedido ${o.orderId || o.order_id} excede a capacidade máxima do veículo (${maxVolumeM3}m³ / ${maxWeightKg}kg)`);
    }
  }

  // Bin-pack individual orders em rotas respeitando limites de capacidade
  const routes: any[] = [];
  let currentStops: any[] = [];
  let currentVol = 0;
  let currentWt = 0;

  // Ordena pedidos por cidade para manter proximidade geográfica
  const sorted = [...orders].sort((a, b) => {
    const cityA = normCity(a.city || "");
    const cityB = normCity(b.city || "");
    const diff = cityA.localeCompare(cityB);
    if (diff !== 0) return diff;
    return (Number(b.volumeM3 ?? b.volume_m3 ?? 0)) - (Number(a.volumeM3 ?? a.volume_m3 ?? 0));
  });

  for (const o of sorted) {
    const vol = Number(o.volumeM3 ?? o.volume_m3 ?? 0.5);
    const wt = Number(o.weightKg ?? o.weight_kg ?? 50);

    if ((currentVol + vol > maxVolumeM3 || currentWt + wt > maxWeightKg) && currentStops.length > 0) {
      routes.push(createRouteFromStops(routes.length + 1, currentStops, origin, maxVolumeM3));
      currentStops = [];
      currentVol = 0;
      currentWt = 0;
    }

    currentStops.push(o);
    currentVol += vol;
    currentWt += wt;
  }

  if (currentStops.length > 0) {
    routes.push(createRouteFromStops(routes.length + 1, currentStops, origin, maxVolumeM3));
  }

  return routes;
}

function createRouteFromStops(index: number, orderList: any[], origin: any, maxVolumeM3: number): any {
  // TSP Sequenciamento por vizinho mais próximo a partir da origem
  const unvisited = [...orderList];
  const orderedStops: any[] = [];
  let curLat = origin.lat;
  let curLng = origin.lng;

  while (unvisited.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const o = unvisited[i];
      const coords = (o.lat && o.lng) ? [o.lat, o.lng] : (getCityCoords(o.city || "") ?? [origin.lat, origin.lng]);
      const d = haversineKm(curLat, curLng, coords[0], coords[1]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = unvisited.splice(bestIdx, 1);
    const coords = (next.lat && next.lng) ? [next.lat, next.lng] : (getCityCoords(next.city || "") ?? [origin.lat, origin.lng]);
    curLat = coords[0];
    curLng = coords[1];
    orderedStops.push(next);
  }

  const deliveryStops = orderedStops.map((o, idx) => {
    const coords = (o.lat && o.lng) ? [o.lat, o.lng] : (getCityCoords(o.city || "") ?? [origin.lat, origin.lng]);
    const vol = Number(o.volumeM3 ?? o.volume_m3 ?? 0.5);
    const wt = Number(o.weightKg ?? o.weight_kg ?? 50);
    const bx = Number(o.boxes ?? 1);
    const name = o.clientName || o.client || o.name || `Cliente ${idx + 1}`;

    return {
      position: idx + 1,
      is_origin: false,
      name,
      address: o.address || o.city || "Endereço",
      city: o.city || "Campina Grande",
      lat: coords[0],
      lng: coords[1],
      boxes: bx,
      volume_m3: vol,
      volumeM3: vol,
      weight_kg: wt,
      weightKg: wt,
      order_id: o.orderId || o.order_id || `ORD-${idx + 1}`,
      orderId: o.orderId || o.order_id || `ORD-${idx + 1}`,
      products: o.products || "Mercadorias",
    };
  });

  const n = deliveryStops.length;
  const lifoManifest: LifoManifestItem[] = [];

  for (let i = 0; i < n; i++) {
    const stop = deliveryStops[n - 1 - i]; // LIFO: última entrega é a primeira no carregamento
    const pos: "FUNDO" | "MEIO" | "PORTA" =
      n === 1 ? "PORTA" : (i === 0 ? "FUNDO" : (i === n - 1 ? "PORTA" : "MEIO"));

    lifoManifest.push({
      loadingStep: i + 1,
      deliveryOrderIndex: n - i,
      compartmentPosition: pos,
      stopName: stop.name,
      orderId: stop.order_id,
      city: stop.city,
      boxes: stop.boxes,
      volumeM3: stop.volume_m3,
      weightKg: stop.weight_kg,
    });
  }

  const allStops = [
    {
      position: 0,
      is_origin: true,
      name: origin.name || "Origem",
      address: origin.address || origin.name || "Origem",
      lat: origin.lat,
      lng: origin.lng,
      boxes: 0,
      volume_m3: 0,
      volumeM3: 0,
      weight_kg: 0,
      weightKg: 0,
    },
    ...deliveryStops,
  ];

  let estKm = 0;
  let lastLat = origin.lat;
  let lastLng = origin.lng;
  for (const stop of deliveryStops) {
    estKm += haversineKm(lastLat, lastLng, stop.lat, stop.lng);
    lastLat = stop.lat;
    lastLng = stop.lng;
  }

  const totalVol = deliveryStops.reduce((s, d) => s + d.volume_m3, 0);
  const totalWt = deliveryStops.reduce((s, d) => s + d.weight_kg, 0);
  const totalBx = deliveryStops.reduce((s, d) => s + d.boxes, 0);

  return {
    id: `route-${index}`,
    index,
    name: `Rota ${index} — ${deliveryStops[0]?.city || "Entrega"}`,
    stops: allStops,
    lifoManifest,
    estimatedKm: parseFloat(estKm.toFixed(1)),
    estimated_km: parseFloat(estKm.toFixed(1)),
    totalVolumeM3: parseFloat(totalVol.toFixed(2)),
    totalWeightKg: parseFloat(totalWt.toFixed(2)),
    totalBoxes: totalBx,
    totalOrders: deliveryStops.length,
    occupancyPct: maxVolumeM3 > 0 ? Math.min(100, Math.round((totalVol / maxVolumeM3) * 100)) : 0,
  };
}
