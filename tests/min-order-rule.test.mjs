/**
 * tests/min-order-rule.test.mjs
 * Testes unitários para regras de pedido mínimo por estado e parser de valores de planilha.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  STATE_MIN_ORDER_VALUE,
  getMinOrderValueForState,
  checkOrderMinEligibility,
} from '../lib/business-rules.ts';
import { parseSpreadsheet } from '../lib/spreadsheet-parser.ts';
import { generateRoutes } from '../lib/route-engine.ts';

describe('Políticas de Pedido Mínimo por Estado (lib/business-rules.ts)', () => {
  it('contém exatamente os valores limites por estado do documento oficial', () => {
    assert.strictEqual(getMinOrderValueForState('PB'), 1500);
    assert.strictEqual(getMinOrderValueForState('AL'), 2000);
    assert.strictEqual(getMinOrderValueForState('BA'), 2000);
    assert.strictEqual(getMinOrderValueForState('CE'), 2000);
    assert.strictEqual(getMinOrderValueForState('PE'), 2000);
    assert.strictEqual(getMinOrderValueForState('RN'), 2000);
    assert.strictEqual(getMinOrderValueForState('SE'), 2000);
    assert.strictEqual(getMinOrderValueForState('MA'), 7000);
    assert.strictEqual(getMinOrderValueForState('PA'), 7000);
    assert.strictEqual(getMinOrderValueForState('PI'), 7000);
    assert.strictEqual(getMinOrderValueForState('TO'), 7000);
    assert.strictEqual(getMinOrderValueForState('AP'), 10000);

    // Estados fora da tabela
    assert.strictEqual(getMinOrderValueForState('SP'), 0);
    assert.strictEqual(getMinOrderValueForState(''), 0);
  });

  it('avalia elegibilidade com precisão para cada faixa de estado', () => {
    // PB (limite 1500)
    const pbAbaixo = checkOrderMinEligibility({ uf: 'PB', totalValue: 1499.90 });
    assert.strictEqual(pbAbaixo.eligible, false);
    assert.strictEqual(pbAbaixo.difference, 0.10);
    assert.ok(pbAbaixo.reason?.includes('abaixo do mínimo'));

    const pbOk = checkOrderMinEligibility({ uf: 'PB', totalValue: 1500.00 });
    assert.strictEqual(pbOk.eligible, true);
    assert.strictEqual(pbOk.difference, 0);

    // PE (limite 2000)
    const peAbaixo = checkOrderMinEligibility({ uf: 'PE', totalValue: 1800 });
    assert.strictEqual(peAbaixo.eligible, false);
    assert.strictEqual(peAbaixo.difference, 200);

    // MA (limite 7000)
    const maAbaixo = checkOrderMinEligibility({ uf: 'MA', totalValue: 6999 });
    assert.strictEqual(maAbaixo.eligible, false);
    assert.strictEqual(maAbaixo.difference, 1);

    // AP (limite 10000)
    const apOk = checkOrderMinEligibility({ uf: 'AP', totalValue: 10500 });
    assert.strictEqual(apOk.eligible, true);
  });
});

describe('Parser de Planilha - Extração de Valores e UF (lib/spreadsheet-parser.ts)', () => {
  it('extrai valor total e caixas corretamente sem conflito de coluna', async () => {
    const csvContent = [
      'Pedido;Cliente;Cidade;UF;Total Item;Caixas;Volume m3;Peso kg',
      'PED-101;Supermercado Alfa;Campina Grande;PB;1.550,50;10;1,2;150',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf-8');
    const orders = await parseSpreadsheet(buffer, 'teste-valor.csv');

    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].orderId, 'PED-101');
    assert.strictEqual(orders[0].totalValue, 1550.50);
    assert.strictEqual(orders[0].boxes, 10);
    assert.strictEqual(orders[0].uf, 'PB');
  });

  it('soma o valor total e métricas quando há múltiplos produtos no mesmo pedido', async () => {
    const csvContent = [
      'Pedido;Cliente;Cidade;UF;Produto;Total Item;Caixas;Volume;Peso',
      'PED-200;Loja Central;Recife;PE;Geladeira;1.200,00;1;0,8;60',
      'PED-200;Loja Central;Recife;PE;Fogão;950,00;1;0,4;35',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf-8');
    const orders = await parseSpreadsheet(buffer, 'teste-multiplos-itens.csv');

    assert.strictEqual(orders.length, 1);
    assert.strictEqual(orders[0].orderId, 'PED-200');
    assert.strictEqual(orders[0].totalValue, 2150.00); // 1200 + 950
    assert.strictEqual(orders[0].boxes, 2);
    assert.strictEqual(orders[0].volumeM3, 1.2);
    assert.strictEqual(orders[0].weightKg, 95);
  });

  it('detecta UF a partir do nome da cidade quando a coluna UF está vazia', async () => {
    const csvContent = [
      'Pedido;Cliente;Cidade;Total Item;Caixas;Volume;Peso',
      'PED-300;Cliente JP;João Pessoa - PB;1.800,00;5;0,5;50',
      'PED-301;Cliente Maceió;Maceió/AL;2.500,00;8;1,0;100',
    ].join('\n');

    const buffer = Buffer.from(csvContent, 'utf-8');
    const orders = await parseSpreadsheet(buffer, 'teste-uf-cidade.csv');

    assert.strictEqual(orders.length, 2);
    assert.strictEqual(orders[0].uf, 'PB');
    assert.strictEqual(orders[1].uf, 'AL');
  });
});

describe('Motor de Roteirização - Validação de Pedido Mínimo (lib/route-engine.ts)', () => {
  const baseConfig = {
    maxVolumeM3: 30,
    maxWeightKg: 10000,
    clusterRadiusKm: 100,
    routeDate: '2026-09-25',
    originName: 'CD Campina Grande',
    originLat: -7.2306,
    originLng: -35.8811,
  };

  it('retem pedidos abaixo do pedido mínimo em unassigned quando enforceMinOrderValue é true', () => {
    const orders = [
      {
        orderId: 'PB-OK',
        client: 'Cliente PB Grande',
        city: 'João Pessoa',
        uf: 'PB',
        volumeM3: 2.0,
        weightKg: 300,
        boxes: 10,
        totalValue: 1800.00, // Acima de 1500
        extra: {},
      },
      {
        orderId: 'PB-BAIXO',
        client: 'Cliente PB Pequeno',
        city: 'Campina Grande',
        uf: 'PB',
        volumeM3: 1.0,
        weightKg: 100,
        boxes: 4,
        totalValue: 900.00, // Abaixo de 1500
        extra: {},
      },
    ];

    const result = generateRoutes(orders, {
      ...baseConfig,
      enforceMinOrderValue: true,
    });

    assert.strictEqual(result.unassigned.length, 1);
    assert.strictEqual(result.unassigned[0].orderId, 'PB-BAIXO');
    assert.ok(result.unassigned[0].extra.unassignedReason.includes('abaixo do mínimo'));

    // O pedido válido deve ser roteirizado
    assert.strictEqual(result.routes.length, 1);
    assert.strictEqual(result.routes[0].stops[0].orders[0].orderId, 'PB-OK');
  });

  it('permite roteirizar pedidos abaixo do mínimo se enforceMinOrderValue for false', () => {
    const orders = [
      {
        orderId: 'PB-BAIXO',
        client: 'Cliente PB Pequeno',
        city: 'Campina Grande',
        uf: 'PB',
        volumeM3: 1.0,
        weightKg: 100,
        boxes: 4,
        totalValue: 900.00,
        extra: {},
      },
    ];

    const result = generateRoutes(orders, {
      ...baseConfig,
      enforceMinOrderValue: false,
    });

    assert.strictEqual(result.unassigned.length, 0);
    assert.strictEqual(result.routes.length, 1);
  });
});
