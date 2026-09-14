import { NextRequest, NextResponse } from 'next/server';
import { generateRoutes, type EngineConfig } from '@/lib/route-engine';
import type { OrderRow } from '@/lib/spreadsheet-parser';
import { resolveOrderCoordinates } from '@/lib/city-geocoding';

export const runtime = 'nodejs';

/**
 * POST /api/routerizador/generate
 * Body JSON: { rows: OrderRow[], config: EngineConfig }
 * Retorna: EngineResult (routes + stats + unassigned)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { rows: OrderRow[]; config: Partial<EngineConfig> };

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json({ error: 'Nenhum pedido fornecido.' }, { status: 400 });
    }

    // Se a importação informa o frete, somente CIF pode criar rotas da frota.
    // Arquivos genéricos sem essa coluna continuam compatíveis com o motor.
    const hasFreightClassification = body.rows.some((row) => row.freightType !== undefined);
    const eligibleRows = hasFreightClassification
      ? body.rows.filter((row) => row.freightType === 'CIF')
      : body.rows;
    if (eligibleRows.length === 0) {
      return NextResponse.json({ error: 'Não há pedidos CIF elegíveis para a frota própria.' }, { status: 422 });
    }

    const config: EngineConfig = {
      maxVolumeM3:     body.config?.maxVolumeM3     ?? 30,
      maxWeightKg:     body.config?.maxWeightKg     ?? 10000,
      clusterRadiusKm: body.config?.clusterRadiusKm ?? 80,
      routeDate:       body.config?.routeDate       ?? new Date().toISOString().slice(0, 10),
      originName:      body.config?.originName      ?? 'Filial',
      originLat:       body.config?.originLat       ?? -7.2306,  // Campina Grande default
      originLng:       body.config?.originLng       ?? -35.8811,
      minVolumeM3:     body.config?.minVolumeM3     ?? 10,
      corridorAngle:   body.config?.corridorAngle   ?? 60,
      prioritizeAging: body.config?.prioritizeAging ?? true,
      returnToOrigin:  body.config?.returnToOrigin  ?? false,
      roadFactor:      body.config?.roadFactor      ?? 1.22,
      averageSpeed:    body.config?.averageSpeed    ?? 55,
      serviceMinutes:  body.config?.serviceMinutes  ?? 40,
      maxHours:        body.config?.maxHours        ?? 72,
    };

    // A cidade/UF da planilha é a fonte de verdade. Antes de montar a rota,
    // confirma coordenadas no cache cartográfico e consulta o mapa apenas para
    // cidades ainda desconhecidas.
    await resolveOrderCoordinates(eligibleRows);
    const result = generateRoutes(eligibleRows, config);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[routerizador/generate]', err);
    return NextResponse.json({ error: 'Erro ao gerar rotas.' }, { status: 500 });
  }
}
