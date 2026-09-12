import { NextRequest, NextResponse } from 'next/server';
import { generateRoutes, type EngineConfig } from '@/lib/route-engine';
import type { OrderRow } from '@/lib/spreadsheet-parser';

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

    const config: EngineConfig = {
      maxVolumeM3:     body.config?.maxVolumeM3     ?? 30,
      maxWeightKg:     body.config?.maxWeightKg     ?? 10000,
      clusterRadiusKm: body.config?.clusterRadiusKm ?? 80,
      routeDate:       body.config?.routeDate       ?? new Date().toISOString().slice(0, 10),
      originName:      body.config?.originName      ?? 'Filial',
      originLat:       body.config?.originLat       ?? -7.2306,  // Campina Grande default
      originLng:       body.config?.originLng       ?? -35.8811,
    };

    const result = generateRoutes(body.rows, config);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[routerizador/generate]', err);
    return NextResponse.json({ error: 'Erro ao gerar rotas.' }, { status: 500 });
  }
}
