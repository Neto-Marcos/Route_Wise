import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { query } from "@/lib/db";

const BRAZILIAN_STATES = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
  "ACRE", "ALAGOAS", "AMAPA", "AMAZONAS", "BAHIA", "CEARA", "DISTRITO FEDERAL", "ESPIRITO SANTO", "GOIAS", "MARANHAO", "MATO GROSSO", "MATO GROSSO DO SUL", "MINAS GERAIS", "PARA", "PARAIBA", "PARANA", "PERNAMBUCO", "PIAUI", "RIO DE JANEIRO", "RIO GRANDE DO NORTE", "RIO GRANDE DO SUL", "RONDONIA", "RORAIMA", "SANTA CATARINA", "SAO PAULO", "SERGIPE", "TOCANTINS",
]);
const normalizePlace = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
const isCityCandidate = (value: string) => {
  const normalized = normalizePlace(value);
  return Boolean(value.trim()) && !/^\d+[\d.-]*$/.test(value.trim()) && !/^(BRASIL|BRAZIL|REGIAO\s+\w+|BASE|BASE OPERACIONAL|ORIGEM|DISTRIBUICAO|SEM\s+CIDADE)$/.test(normalized);
};
const cityFromStop = (name: string, address: string) => {
  const nameParts = String(name || "").split(/\s[-–]\s/).map((part) => part.trim()).filter(Boolean);
  const nameCity = nameParts.length > 1 ? nameParts.at(-1)! : "";
  if (isCityCandidate(nameCity)) return nameCity;

  const addressParts = String(address || "").split(/[,;/]/).map((part) => part.trim()).filter(Boolean);
  const stateIndex = addressParts.findIndex((part) => BRAZILIAN_STATES.has(normalizePlace(part)));
  const addressCity = stateIndex > 0 ? addressParts[stateIndex - 1] : "";
  return isCityCandidate(addressCity) ? addressCity : null;
};

export async function GET(request: Request) {
  const session = await getSession("dispatcher");
  if (!session) {
    return NextResponse.json({ error: "Sessão necessária" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = searchParams.get("month") || currentMonthStr;

  try {
    // 1. Meta do Mês
    const goalRes = await query(
      `SELECT * FROM company_goals WHERE company_id = $1 AND month = $2 LIMIT 1`,
      [session.companyId, month]
    );
    const targetKm = goalRes.rows.length > 0 ? Number(goalRes.rows[0].target_km) : 5000;
    const targetDeliveries = goalRes.rows.length > 0 ? Number(goalRes.rows[0].target_deliveries) : 200;

    // 2. Rotas do mês selecionado
    const routesRes = await query(
      `SELECT r.id, r.name, r.status, r.route_date,
              COALESCE(r.actual_km, r.estimated_km, 0) as km_val,
              (SELECT count(*) FROM route_stops s WHERE s.route_id = r.id AND s.status = 'delivered') as completed_stops,
              (SELECT count(*) FROM route_stops s WHERE s.route_id = r.id) as total_stops
       FROM routes r
       WHERE r.company_id = $1 AND r.route_date::text LIKE $2
         AND r.status NOT IN ('draft', 'cancelled')
       ORDER BY r.route_date ASC`,
      [session.companyId, `${month}%`]
    );

    let totalKmRealized = 0;
    let totalDeliveriesRealized = 0;
    let totalEstimatedFuel = 0;
    let totalRevenue = 0;
    const dayMap = new Map<string, { km: number; deliveries: number; routes: number }>();

    for (const row of routesRes.rows) {
      const km = Number(row.km_val) || 0;
      const deliveries = Number(row.completed_stops) || 0;
      totalKmRealized += km;
      totalDeliveriesRealized += deliveries;
      totalEstimatedFuel += km * 3.85; // estimativa R$/km

      const d = String(row.route_date || "").slice(0, 10);
      if (d) {
        const cur = dayMap.get(d) || { km: 0, deliveries: 0, routes: 0 };
        cur.km += km;
        cur.deliveries += deliveries;
        cur.routes += 1;
        dayMap.set(d, cur);
      }
    }

    // 3. Projeção inteligente de meta
    const today = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const isCurrentMonth = month === currentMonthStr;

    let projection = {
      dailyAvgKm: 0,
      projectedTotalKm: totalKmRealized,
      pctCurrent: targetKm > 0 ? Math.min(100, Math.round((totalKmRealized / targetKm) * 100)) : 0,
      projectedPctMonthEnd: 0,
      forecastStatusText: "Sem dados suficientes para projeção",
      forecastBeatDay: null as number | null,
    };

    if (isCurrentMonth && today > 0) {
      const dailyAvgKm = totalKmRealized / today;
      const remainingDays = Math.max(0, daysInMonth - today);
      const projectedTotalKm = Math.round(totalKmRealized + dailyAvgKm * remainingDays);
      const projectedPct = targetKm > 0 ? Math.round((projectedTotalKm / targetKm) * 100) : 0;

      let forecastBeatDay: number | null = null;
      let forecastStatusText = "";

      if (dailyAvgKm > 0 && targetKm > 0) {
        const daysToHitTarget = Math.ceil(targetKm / dailyAvgKm);
        if (daysToHitTarget <= daysInMonth) {
          forecastBeatDay = daysToHitTarget;
          forecastStatusText = `No ritmo atual (${dailyAvgKm.toFixed(0)} km/dia), a meta de ${targetKm.toLocaleString("pt-BR")} km será batida por volta do dia ${forecastBeatDay}!`;
        } else {
          forecastStatusText = `Projeção de atingir ${projectedPct}% da meta até o dia ${daysInMonth} (${projectedTotalKm.toLocaleString("pt-BR")} km previstos).`;
        }
      }

      projection = {
        dailyAvgKm: Math.round(dailyAvgKm * 10) / 10,
        projectedTotalKm,
        pctCurrent: targetKm > 0 ? Math.min(100, Math.round((totalKmRealized / targetKm) * 100)) : 0,
        projectedPctMonthEnd: projectedPct,
        forecastStatusText,
        forecastBeatDay,
      };
    }

    // 4. Heatmap de cidades / pontos de parada
    const stopsRes = await query(
      `SELECT s.address, s.lat, s.lng, s.name, s.is_origin, (s.status = 'delivered') as completed, r.name as route_name
       FROM route_stops s
       JOIN routes r ON r.id = s.route_id
       WHERE r.company_id = $1 AND r.status NOT IN ('draft', 'cancelled') AND s.lat IS NOT NULL AND s.lng IS NOT NULL
       ORDER BY COALESCE(s.delivered_at, r.created_at) DESC
       LIMIT 300`,
      [session.companyId]
    );

    // Agrupamento de densidade por cidade
    const cityCountMap: Record<string, { count: number; lat: number; lng: number }> = {};
    const heatPoints: Array<[number, number, number]> = [];

    for (const s of stopsRes.rows) {
      const lat = Number(s.lat);
      const lng = Number(s.lng);
      const city = !s.is_origin ? cityFromStop(String(s.name || ""), String(s.address || "")) : null;
      if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0 && city) {
        heatPoints.push([lat, lng, 0.7]);
        const key = city.slice(0, 50);
        if (!cityCountMap[key]) {
          cityCountMap[key] = { count: 0, lat, lng };
        }
        cityCountMap[key].count += 1;
      }
    }

    const topCities = Object.entries(cityCountMap)
      .map(([city, data]) => ({ city, count: data.count, lat: data.lat, lng: data.lng }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // 5. Ranking de Produtividade dos Motoristas
    const driverRankRes = await query(
      `SELECT d.name as driver_name,
              COUNT(DISTINCT r.id) as total_routes,
              SUM(COALESCE(r.actual_km, r.estimated_km, 0)) as total_km,
              SUM((SELECT count(*) FROM route_stops s WHERE s.route_id = r.id AND s.status = 'delivered')) as completed_deliveries
       FROM routes r
       JOIN drivers d ON d.id = r.driver_id
       WHERE r.company_id = $1 AND r.route_date::text LIKE $2
         AND r.status NOT IN ('draft', 'cancelled')
       GROUP BY d.id, d.name
       ORDER BY completed_deliveries DESC, total_km DESC
       LIMIT 5`,
      [session.companyId, `${month}%`]
    ).catch(() => ({ rows: [] }));

    const driverRanking = driverRankRes.rows.map((row) => ({
      name: row.driver_name,
      routes: Number(row.total_routes || 0),
      deliveries: Number(row.completed_deliveries || 0),
      km: Math.round(Number(row.total_km || 0) * 10) / 10,
    }));

    // 6. Indicadores de Qualidade & Financeiros
    const otifPct = totalDeliveriesRealized > 0 ? Math.min(100, Math.round((totalDeliveriesRealized / (targetDeliveries || 100)) * 100)) : 95;
    const costPerKm = totalKmRealized > 0 ? parseFloat((totalEstimatedFuel / totalKmRealized).toFixed(2)) : 3.85;
    const costRatioPct = totalRevenue > 0 ? parseFloat(((totalEstimatedFuel / totalRevenue) * 100).toFixed(1)) : 4.2;

    const fleetStatus = {
      active: routesRes.rows.filter((r) => r.status === "active").length,
      assigned: routesRes.rows.filter((r) => r.status === "assigned").length,
      completed: routesRes.rows.filter((r) => r.status === "completed").length,
      total: routesRes.rows.length,
    };

    // 7. Score de pontualidade por cliente / destino (OTIF aproximado)
    const clientScoreRes = await query(
      `SELECT s.name, count(*) as total_stops,
              sum(case when s.status = 'delivered' then 1 else 0 end) as completed_stops
       FROM route_stops s
       JOIN routes r ON r.id = s.route_id
       WHERE r.company_id = $1 AND r.status NOT IN ('draft', 'cancelled')
       GROUP BY s.name
       HAVING count(*) >= 2
       ORDER BY total_stops DESC
       LIMIT 10`,
      [session.companyId]
    );

    const clientScores = clientScoreRes.rows.map((row) => {
      const total = Number(row.total_stops) || 1;
      const completed = Number(row.completed_stops) || 0;
      const score = Math.round((completed / total) * 100);
      return {
        name: row.name,
        total,
        completed,
        score,
        status: score >= 90 ? "Excelente" : score >= 75 ? "Bom" : "Atenção",
      };
    });

    return NextResponse.json({
      month,
      targetKm,
      targetDeliveries,
      realizedKm: Math.round(totalKmRealized * 10) / 10,
      realizedDeliveries: totalDeliveriesRealized,
      totalRevenue,
      totalEstimatedFuel,
      costPerKm,
      costRatioPct,
      otifPct,
      fleetStatus,
      driverRanking,
      projection,
      historyDays: Array.from(dayMap.entries()).map(([date, val]) => ({
        date,
        km: Math.round(val.km * 10) / 10,
        deliveries: val.deliveries,
        routes: val.routes,
      })),
      heatPoints,
      topCities,
      clientScores,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
