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

// ─── Políticas de Pedido Mínimo por Estado (Regra Comercial) ────────────────

export const STATE_MIN_ORDER_VALUE: Record<string, number> = {
  PB: 1500,
  AL: 2000,
  BA: 2000,
  CE: 2000,
  PE: 2000,
  RN: 2000,
  SE: 2000,
  MA: 7000,
  PA: 7000,
  PI: 7000,
  TO: 7000,
  AP: 10000,
};

export function getMinOrderValueForState(uf?: string): number {
  if (!uf) return 0;
  const cleanUf = uf.trim().toUpperCase();
  return STATE_MIN_ORDER_VALUE[cleanUf] ?? 0;
}

export interface MinOrderCheckResult {
  eligible: boolean;
  minRequired: number;
  currentValue: number;
  difference: number;
  reason?: string;
}

export function checkOrderMinEligibility(order: { uf?: string; totalValue?: number; city?: string; orderId?: string }): MinOrderCheckResult {
  const uf = (order.uf ?? "").trim().toUpperCase();
  const minRequired = getMinOrderValueForState(uf);
  const currentValue = order.totalValue ?? 0;

  if (minRequired === 0) {
    return {
      eligible: true,
      minRequired: 0,
      currentValue,
      difference: 0,
    };
  }

  const eligible = currentValue >= minRequired;
  const difference = eligible ? 0 : Math.round((minRequired - currentValue) * 100) / 100;
  const reason = eligible
    ? undefined
    : `Pedido com valor de ${currentValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} abaixo do mínimo de ${minRequired.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} para o estado ${uf}`;

  return {
    eligible,
    minRequired,
    currentValue,
    difference,
    reason,
  };
}

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface EngineConfig {
  /** Volume máximo por veículo em m³. Padrão: 30 */
  maxVolumeM3: number;
  /** Peso máximo por veículo em kg. Padrão: 10.000 */
  maxWeightKg: number;
  /** Raio de clusterização em km. Padrão: 80 */
  clusterRadiusKm: number;
  /** Data de entrega (YYYY-MM-DD) */
  routeDate: string;
  /** Nome do ponto de origem (base/filial) */
  originName: string;
  /** Lat/lng da origem */
  originLat: number;
  originLng: number;
  minVolumeM3?: number;
  corridorAngle?: number;
  prioritizeAging?: boolean;
  returnToOrigin?: boolean;
  roadFactor?: number;
  averageSpeed?: number;
  serviceMinutes?: number;
  maxHours?: number;
  /** Quando true, valida e bloqueia pedidos abaixo do valor mínimo do estado */
  enforceMinOrderValue?: boolean;
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
  // Pará
  'SANTAREM': [-2.4366, -54.6868],
  'MARABA': [-5.3681, -49.1175],
  'CASTANHAL': [-1.2941, -47.9254],
  'ANANINDEUA': [-1.3659, -48.3722],
  'PARAUAPEBAS': [-6.0680, -49.9010],
  'TUCUMA': [-6.7519, -51.1593],
  'REDENCAO': [-8.0266, -50.0298],
  'ALTAMIRA': [-3.2053, -52.2118],
  'ITAITUBA': [-4.2764, -55.9836],
  'TUCURUI': [-3.7583, -49.6725],
  'PORTO DE MOZ': [-1.7496, -52.2361],
  'SENADOR JOSE PORFIRIO': [-2.5919, -51.9544],
  'PORTO DE MOZ/PA': [-1.7496, -52.2361],
  'SENADOR JOSE PORFIRIO/PA': [-2.5919, -51.9544],
  'ALENQUER': [-1.9396, -54.7384],
  'OBIDOS': [-1.9009, -55.5132],
  'ORIXIMINA': [-1.7654, -55.8658],
  'CURUCA': [-0.7313, -47.8576],
  'SAO MIGUEL DO GUAMA': [-1.6156, -47.4722],
  'CAPANEMA': [-1.1950, -47.1795],
  'PARAGOMINAS': [-2.9972, -47.4769],
  'TUCUMA PA': [-6.7519, -51.1593],
  'MOJU': [-1.8839, -48.7715],
  'ABAETETUBA': [-1.7264, -48.8797],
  'CAMETA': [-2.2456, -49.4958],
  'BREVES': [-1.6835, -50.4828],
  'SOURE': [-0.7255, -48.5229],
  'TOME ACU': [-2.4178, -48.1506],
  'BRAGANCA': [-1.0525, -46.7666],
  'VISEU': [-1.1950, -46.1411],
  'SAO FELIX DO XINGU': [-6.6438, -51.9956],
  'OURILANDIA DO NORTE': [-6.7600, -51.0825],
  'AGUA AZUL DO NORTE': [-6.1119, -50.0033],
  'XINGUARA': [-7.0996, -49.9461],
  'CONCEICAO DO ARAGUAIA': [-8.2561, -49.2631],
  'MARABA PA': [-5.3681, -49.1175],
  // Maranhão
  'SAO LUIS': [-2.5297, -44.3028],
  'IMPERATRIZ': [-5.5253, -47.4924],
  'SAO JOSE DE RIBAMAR': [-2.5597, -44.0564],
  'TIMON': [-5.0939, -42.8322],
  'CAXIAS': [-4.8672, -43.3569],
  'CODÓ': [-4.4531, -43.8858],
  'PACO DO LUMIAR': [-2.5597, -44.1064],
  'ACAILANDIA': [-4.9453, -47.5003],
  'BALSAS': [-7.5328, -46.0361],
  'BACABAL': [-4.2280, -44.7889],
  'SANTA INES': [-3.6656, -45.3803],
  'BURITICUPU': [-4.3094, -46.4417],
  'BARRA DO CORDA': [-5.5033, -45.2436],
  'PRESIDENTE DUTRA': [-5.2917, -44.4906],
  'COROATA': [-4.1358, -44.1244],
  'VITORINO FREIRE': [-4.4275, -45.2047],
  'PINHEIRO': [-2.5219, -45.0836],
  'CACHOEIRA GRANDE': [-3.0019, -44.4486],
  'PEDREIRAS': [-4.5667, -44.5806],
  // Tocantins
  'PALMAS': [-10.1753, -48.2982],
  'ARAGUAINA': [-7.1919, -48.2072],
  'GURUPI': [-11.7303, -49.0687],
  'PORTO NACIONAL': [-10.7069, -48.4161],
  'PARAISO DO TOCANTINS': [-10.1742, -48.8869],
  'FORMOSO DO ARAGUAIA': [-11.8041, -49.5292],
  'COLINAS DO TOCANTINS': [-8.0561, -48.4761],
  'ARAGARCAS': [-15.8950, -52.2411],
  // Amapá
  'MACAPA': [0.0356, -51.0705],
  'SANTANA': [-0.0611, -51.1741],
  // Piauí (extend)
  'TERESINA': [-5.0892, -42.8019],
  'PARNAIBA': [-2.9058, -41.7769],
  'PICOS': [-7.0775, -41.4675],
  'FLORIANO': [-6.7669, -43.0244],
  'CAMPO MAIOR': [-4.8302, -42.1711],
  // Ceará (extend)
  'IGUATU': [-6.3594, -39.2986],
  'QUIXADA': [-4.9706, -39.0150],
  'RUSSAS': [-4.9389, -37.9761],
  'ITAPAJE': [-3.6908, -39.5836],
  'CRATEUS': [-5.1761, -40.6764],
  'ACARAU': [-2.8856, -40.1197],
  'CAMOCIM': [-2.9022, -40.8428],
  'TIANGUA': [-3.7294, -40.9942],
  'CANINDE': [-4.3556, -39.3144],
  'CAPISTRANO': [-4.4664, -38.9094],
  'ARATUBA': [-4.4144, -39.0625],
  'MARANGUAPE': [-3.8892, -38.6814],
  'BATURITE': [-4.3286, -38.8833],
  'PALMACIA': [-4.1353, -38.8481],
  'PACATUBA': [-3.9822, -38.6117],
  'CANINDE CE': [-4.3556, -39.3144],
  'MARACANAU': [-3.7783, -38.6269],
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
    if (config.enforceMinOrderValue) {
      const eligibility = checkOrderMinEligibility(o);
      if (!eligibility.eligible) {
        o.extra = { ...o.extra, unassignedReason: eligibility.reason ?? "Abaixo do pedido mínimo" };
        unassigned.push(o);
        continue;
      }
    }
    const city = normCity(o.city);
    const uf = (o.uf ?? '').trim().toUpperCase();
    const key = `${uf}|${city}`;
    const cityCoords = getCityCoords(o.city);
    if ((!Number.isFinite(o.lat) || !Number.isFinite(o.lng)) && cityCoords) {
      o.lat = cityCoords[0];
      o.lng = cityCoords[1];
    }
    if (!byCity.has(key)) {
      const suppliedCoords = Number.isFinite(o.lat) && Number.isFinite(o.lng) ? [o.lat!, o.lng!] as [number, number] : null;
      byCity.set(key, { city, uf, orders: [], coords: suppliedCoords ?? cityCoords });
    }
    byCity.get(key)!.orders.push(o);
  }

  // 2. Agrupar pela UF. A operação define estado como a fronteira logística
  // primária: cidades de estados diferentes nunca compartilham uma rota, e as
  // cidades do mesmo estado só são separadas por capacidade/limite de paradas.
  type CityGroup = { uf: string; cities: string[]; coords: [number, number]; bearing: number; orders: OrderRow[] };
  const byState = new Map<string, CityGroup>();

  for (const { city, uf, orders: cityOrders, coords } of byCity.values()) {
    // Nunca desenhar destino desconhecido na origem: ele deve ser conferido na
    // planilha/mapa antes do carregamento, em vez de criar marcadores falsos.
    if (!coords) {
      unassigned.push(...cityOrders);
      continue;
    }
    // Sem UF não pode ser combinado com outro destino desconhecido.
    const groupKey = uf || `SEM_UF:${city}`;
    const groupUf = uf || "";
    const cityCoords = coords;
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

  // 4. Preencher o veículo por corredor geográfico. A quantidade de paradas
  // nunca encerra uma rota: apenas volume/peso. Cada rota fica no mesmo estado
  // e em um mesmo sentido a partir da base; assim uma cidade só entra quando
  // está no trajeto (aproximação cartográfica) ou muito próxima dele.
  const routes: SuggestedRoute[] = [];
  let routeIndex = 1;

  for (const group of groups) {
    const pending = [...group.orders].sort((a, b) => {
      const distanceDiff = haversineKm(originLat, originLng, a.lat!, a.lng!) - haversineKm(originLat, originLng, b.lat!, b.lng!);
      if (distanceDiff) return distanceDiff;
      return config.prioritizeAging ? agingDays(b) - agingDays(a) : b.volumeM3 - a.volumeM3;
    });

    while (pending.length) {
      const seed = pending.shift()!;
      const corridorBearing = bearingDeg(originLat, originLng, seed.lat!, seed.lng!);
      const corridorHalfAngle = Math.max(12, (config.corridorAngle ?? 50) / 2);
      const currentRoute: OrderRow[] = [seed];
      let currentVol = seed.volumeM3;
      let currentWt = seed.weightKg;

      // Escolhe sempre o pedido viável mais próximo dentro do mesmo corredor.
      // Pedidos fora dele formam outra rota, em vez de provocar um desvio.
      while (true) {
        const candidateIndex = pending
          .map((order, index) => ({ order, index }))
          .filter(({ order }) =>
            currentVol + order.volumeM3 <= maxVolumeM3 &&
            currentWt + order.weightKg <= maxWeightKg &&
            angleDiff(corridorBearing, bearingDeg(originLat, originLng, order.lat!, order.lng!)) <= corridorHalfAngle,
          )
          .sort((a, b) => {
            const distanceDiff = haversineKm(originLat, originLng, a.order.lat!, a.order.lng!) - haversineKm(originLat, originLng, b.order.lat!, b.order.lng!);
            if (distanceDiff) return distanceDiff;
            return config.prioritizeAging ? agingDays(b.order) - agingDays(a.order) : b.order.volumeM3 - a.order.volumeM3;
          })[0]?.index;
        if (candidateIndex === undefined) break;
        const [candidate] = pending.splice(candidateIndex, 1);
        currentRoute.push(candidate);
        currentVol += candidate.volumeM3;
        currentWt += candidate.weightKg;
      }

      currentRoute.sort((a, b) => haversineKm(originLat, originLng, a.lat!, a.lng!) - haversineKm(originLat, originLng, b.lat!, b.lng!));
      routes.push(buildRoute(routeIndex++, currentRoute, group, config));
    }
  }

  // 4b. Merge de rotas pequenas com baixa ocupação na mesma região
  // Se duas rotas têm ≤ 3 paradas e ocupação < 40% e cabem juntas → mesclar
  function getRouteState(route: SuggestedRoute): string {
    const states = new Set<string>();
    for (const stop of route.stops) {
      for (const o of stop.orders) {
        if (o.uf) states.add(o.uf.trim().toUpperCase());
      }
    }
    return Array.from(states).sort().join(',');
  }

  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < routes.length; i++) {
      if (routes[i].stops.length > 3) continue;
      if (routes[i].occupancyPct > 50) continue;
      for (let j = i + 1; j < routes.length; j++) {
        if (routes[j].stops.length > 3) continue;
        if (routes[j].occupancyPct > 50) continue;
        // Check same state region
        const stateI = getRouteState(routes[i]);
        const stateJ = getRouteState(routes[j]);
        const sameRegion = stateI === stateJ || stateI.split(',').some(s => stateJ.split(',').includes(s));
        if (!sameRegion) continue;
        // Check combined volume fits
        const combinedVol = routes[i].totalVolumeM3 + routes[j].totalVolumeM3;
        const combinedWt = routes[i].totalWeightKg + routes[j].totalWeightKg;
        if (combinedVol > maxVolumeM3 || combinedWt > maxWeightKg) continue;
        // Merge j into i
        const allOrders: OrderRow[] = [];
        for (const stop of routes[i].stops) allOrders.push(...stop.orders);
        for (const stop of routes[j].stops) allOrders.push(...stop.orders);
        const combinedGroup = {
          uf: stateI || stateJ,
          cities: [...routes[i].stops.map(s => s.city), ...routes[j].stops.map(s => s.city)],
          coords: routes[i].stops[0] ? [routes[i].stops[0].lat, routes[i].stops[0].lng] as [number, number] : [originLat, originLng] as [number, number],
        };
        routes[i] = buildRoute(routes[i].index, allOrders, combinedGroup, config);
        routes.splice(j, 1);
        merged = true;
        break;
      }
      if (merged) break;
    }
  }

  // Renumerate after merges
  routes.forEach((r, idx) => {
    r.index = idx + 1;
    const n = r.stops.length;
    r.name = n === 1
      ? `Rota ${r.index} — ${r.stops[0]?.city}`
      : `Rota ${r.index} — ${r.stops[0]?.city} + ${n - 1} cidades`;
    // Fix loading sequence
    r.stops.forEach((s, i) => { s.loadingSequence = n - i; });
  });

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
