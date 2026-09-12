import { NextRequest, NextResponse } from 'next/server';
import { parseSpreadsheet } from '@/lib/spreadsheet-parser';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/routerizador/parse
 * Body: multipart/form-data com campo "file" (xlsx ou csv)
 * Retorna: { rows: OrderRow[], total: number, cities: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Nenhum arquivo enviado.' }, { status: 400 });
    }

    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/csv',
    ];
    if (!allowed.some(t => file.type.includes(t.split('/')[1])) && !file.name.match(/\.(xlsx?|csv)$/i)) {
      return NextResponse.json({ error: 'Formato inválido. Envie .xlsx ou .csv.' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const rows = await parseSpreadsheet(buffer, file.name);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Nenhum pedido elegível encontrado na planilha.' }, { status: 422 });
    }

    const cities = [...new Set(rows.map(r => r.city).filter(Boolean))].sort();

    return NextResponse.json({
      rows,
      total: rows.length,
      cities,
      filename: file.name,
    });
  } catch (err) {
    console.error('[routerizador/parse]', err);
    return NextResponse.json({ error: 'Erro ao processar a planilha.' }, { status: 500 });
  }
}
