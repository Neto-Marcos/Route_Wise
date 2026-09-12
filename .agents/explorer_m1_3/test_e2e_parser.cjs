function stripBom(str) {
  if (typeof str !== 'string') return '';
  return str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
}

function normalizeHeader(header) {
  if (!header) return '';
  return String(header)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') {
    return isNaN(value) || !isFinite(value) ? fallback : value;
  }
  let str = String(value).trim();
  if (!str) return fallback;

  str = str.replace(/(?:m\^?3|cm\^?3|dm\^?3|m³|cbm)/gi, '');
  str = str.replace(/(?:kgs?|quilos?|kilos?|tons?|cxs?|caixas?|volumes?|vols?|itens?|unid(?:ades?)?|un|pe[çc]as?)/gi, '');
  str = str.replace(/[^\d.,+-]/gi, '').trim();
  if (!str) return fallback;

  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    if (lastComma > lastDot) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (hasComma) {
    str = str.replace(',', '.');
  } else if (hasDot) {
    const dots = str.split('.').length - 1;
    if (dots > 1) {
      str = str.replace(/\./g, '');
    }
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ',';

  const candidates = [';', ',', '\t', '|'];
  const scores = {};

  for (const delim of candidates) {
    scores[delim] = 0;
    const counts = [];
    for (const line of lines) {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuotes = !inQuotes;
        else if (line[i] === delim && !inQuotes) count++;
      }
      counts.push(count);
    }
    if (counts.length > 0 && counts[0] > 0) {
      const allEqual = counts.every(c => c === counts[0]);
      if (allEqual) scores[delim] = counts[0] * 10;
      else scores[delim] = counts.reduce((a, b) => a + b, 0) / counts.length;
    }
  }

  let bestDelim = ';';
  let maxScore = -1;
  for (const [delim, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestDelim = delim;
    }
  }
  return maxScore > 0 ? bestDelim : (text.includes(';') ? ';' : ',');
}

function parseCsvToGrid(text) {
  text = stripBom(text);
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === delimiter) {
        row.push(field.trim());
        field = '';
        i++;
      } else if (char === '\r') {
        if (i + 1 < len && text[i + 1] === '\n') i++;
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (char === '\n') {
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = '';
        i++;
      } else {
        field += char;
        i++;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some(f => f.length > 0)) rows.push(row);
  }
  return rows;
}

const COLUMN_ALIASES = {
  clientName: ['cliente', 'destinatario', 'razao social', 'nome', 'comprador', 'client', 'recipient', 'customer', 'destinatario cliente', 'cliente destinatario', 'consignatario', 'empresa', 'loja', 'recebedor'],
  address: ['endereco', 'logradouro', 'endereco completo', 'rua', 'local', 'local de entrega', 'endereco de entrega', 'address', 'entrega', 'destinatario endereco'],
  city: ['cidade', 'municipio', 'destino', 'city', 'cidade destino', 'cidade entrega', 'cidade de entrega', 'municipio destino', 'municipio de entrega', 'localidade', 'praca'],
  uf: ['uf', 'estado', 'state', 'sigla uf', 'regiao', 'uf destino', 'uf entrega'],
  orderId: ['pedido', 'numero pedido', 'no pedido', 'num pedido', 'numero do pedido', 'order id', 'order', 'id pedido', 'nf', 'nfe', 'nota fiscal', 'danfe', 'chave nf', 'chave nfe', 'documento', 'romaneio', 'doc'],
  products: ['produto', 'produtos', 'descricao', 'conteudo', 'mercadoria', 'mercadorias', 'description', 'itens descricao', 'tipo de carga', 'carga'],
  volumeM3: ['cubagem m3', 'cubagem', 'volume m3', 'vol m3', 'm3', 'cbm', 'metragem cubica', 'cubagem total', 'volume cubico'],
  weightKg: ['peso kg', 'peso', 'peso bruto', 'peso liquido', 'peso total', 'kg', 'weight', 'peso bruto kg', 'peso liq kg', 'peso liquido kg'],
  boxes: ['volumes', 'qtd volumes', 'quantidade de volumes', 'caixas', 'cx', 'cxs', 'boxes', 'qty', 'quantidade', 'qtd', 'qtde', 'itens', 'pacotes', 'unidades'],
  lat: ['lat', 'latitude', 'lat entrega', 'coord y', 'y'],
  lng: ['lng', 'lon', 'long', 'longitude', 'lng entrega', 'coord x', 'x']
};

function findHeaderRow(grid) {
  let bestRowIndex = 0;
  let maxMatchedCount = -1;
  let bestMapping = {};

  const scanLimit = Math.min(grid.length, 10);
  for (let r = 0; r < scanLimit; r++) {
    const row = grid[r];
    const normalizedRow = row.map(normalizeHeader);
    const mapping = {};
    const usedIndices = new Set();

    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      for (const alias of aliases) {
        if (mapping[field] !== undefined) break;
        for (let c = 0; c < normalizedRow.length; c++) {
          if (usedIndices.has(c)) continue;
          if (normalizedRow[c] === alias) {
            mapping[field] = c;
            usedIndices.add(c);
            break;
          }
        }
      }
    }

    const matchedCount = Object.keys(mapping).length;
    if (matchedCount > maxMatchedCount) {
      maxMatchedCount = matchedCount;
      bestRowIndex = r;
      bestMapping = mapping;
    }
    // If we matched client, address, city and at least one metric, we are confident
    if (mapping.clientName !== undefined && mapping.address !== undefined && mapping.city !== undefined) {
      bestRowIndex = r;
      bestMapping = mapping;
      break;
    }
  }

  return { headerRowIndex: bestRowIndex, mapping: bestMapping };
}

function processGrid(grid) {
  if (!grid || grid.length < 2) {
    throw new Error('A planilha enviada não contém registros de pedidos.');
  }

  const { headerRowIndex, mapping } = findHeaderRow(grid);

  // Validate required minimum columns: we need client or address or city
  if (mapping.clientName === undefined && mapping.address === undefined) {
    throw new Error('Não foi possível identificar as colunas obrigatórias (Cliente/Destinatário ou Endereço) na planilha.');
  }

  const orders = [];

  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;

    const rawClient = mapping.clientName !== undefined ? row[mapping.clientName] : '';
    const rawAddress = mapping.address !== undefined ? row[mapping.address] : '';
    const rawCity = mapping.city !== undefined ? row[mapping.city] : '';
    const rawUf = mapping.uf !== undefined ? row[mapping.uf] : '';
    const rawOrderId = mapping.orderId !== undefined ? row[mapping.orderId] : '';
    const rawProducts = mapping.products !== undefined ? row[mapping.products] : '';
    const rawVolume = mapping.volumeM3 !== undefined ? row[mapping.volumeM3] : '';
    const rawWeight = mapping.weightKg !== undefined ? row[mapping.weightKg] : '';
    const rawBoxes = mapping.boxes !== undefined ? row[mapping.boxes] : '';
    const rawLat = mapping.lat !== undefined ? row[mapping.lat] : '';
    const rawLng = mapping.lng !== undefined ? row[mapping.lng] : '';

    const clientName = String(rawClient || '').trim();
    const address = String(rawAddress || '').trim();
    let city = String(rawCity || '').trim();
    let uf = String(rawUf || '').trim().toUpperCase();

    // Skip empty lines
    if (!clientName && !address) continue;

    // Parse city and UF if combined
    if (!uf && city) {
      const match = city.match(/^(.*?)\s*[-/,\s]\s*([A-Za-z]{2})$/);
      if (match) {
        city = match[1].trim();
        uf = match[2].toUpperCase();
      }
    }

    const orderId = String(rawOrderId || '').trim() || `PED-${(orders.length + 1).toString().padStart(3, '0')}`;
    const products = String(rawProducts || '').trim() || undefined;

    let volumeM3 = sanitizeNumber(rawVolume, 0);
    if (volumeM3 <= 0) volumeM3 = 0.05; // Fallback minimum 0.05 m³

    let weightKg = sanitizeNumber(rawWeight, 0);
    if (weightKg <= 0) weightKg = 1.0; // Fallback minimum 1.0 kg

    let boxes = Math.round(sanitizeNumber(rawBoxes, 1));
    if (boxes <= 0) boxes = 1;

    const lat = rawLat !== '' ? sanitizeNumber(rawLat, undefined) : undefined;
    const lng = rawLng !== '' ? sanitizeNumber(rawLng, undefined) : undefined;

    orders.push({
      orderId,
      clientName: clientName || `Cliente ${orderId}`,
      address: address || city,
      city: city || 'Não Informada',
      uf: uf || undefined,
      volumeM3: Number(volumeM3.toFixed(3)),
      weightKg: Number(weightKg.toFixed(2)),
      boxes,
      products,
      ...(lat !== undefined && { lat }),
      ...(lng !== undefined && { lng })
    });
  }

  return orders;
}

const canonicalCsv = `Pedido,Cliente,Endereço,Cidade,UF,Cubagem m3,Peso kg,Volumes,Produtos
PED-101,Mercado Sol Nascente,Av. Brasil 1500,Campinas,SP,2.50,320.0,15,Bebidas e Alimentos
PED-102,Farmácia Central,Rua Barão de Jaguara 820,Campinas,SP,0.80,65.0,4,Medicamentos
PED-103,Padaria São José,Av. Andrade Neves 450,Campinas,SP,1.40,180.0,8,Farinhas e Insumos
PED-104,Auto Peças Sumaré,Av. Rebouças 900,Sumaré,SP,3.20,540.0,22,Peças Automotivas
PED-105,Materiais Anhanguera,Rua José Ferreira 100,Hortolândia,SP,4.10,750.0,30,Ferragens
PED-106,Supermercado Paulínia,Av. José Paulino 300,Paulínia,SP,5.00,900.0,35,Secos e Molhados
PED-107,Lojas Americana,Rua Rui Barbosa 55,Americana,SP,3.80,610.0,18,Utilidades Domésticas
PED-108,Atacado Santa Bárbara,Rod. SP-304 km 135,Santa Bárbara d'Oeste,SP,6.20,1100.0,45,Alimentos em Fardo
PED-109,Restaurante Valinhos,Rua Doze de Outubro 45,Valinhos,SP,1.10,120.0,6,Hortifruti
PED-110,Empório Vinhedo,Estrada da Boiada 1200,Vinhedo,SP,2.20,290.0,12,Bebidas Finas
PED-111,Boutique Indaiatuba,Av. Presidente Vargas 700,Indaiatuba,SP,1.90,210.0,9,Vestuário
PED-112,Centro Logístico Jundiaí,Av. dos Imigrantes 2500,Jundiaí,SP,7.50,1450.0,55,Cargas Diversas`;

const brazilianCsv = `\uFEFFPedido;Cliente;Endereço;Cidade;UF;Cubagem (m³);Peso Bruto;Caixas;Mercadoria
PED-201;Loja Alpha;"Rua das Flores, 10";Campinas - SP;;1,85 m³;320,5 kg;12 cx;Eletrônicos
PED-202;Mercado Beta;Av. Paulista, 1000;São Paulo;SP;0,45 m³;65 kg;5;Alimentos
PED-203;Distribuidora Gamma;Rodovia Anhanguera km 100;Jundiaí;SP;12,50;1.850,00;40;Bebidas`;

const grid1 = parseCsvToGrid(canonicalCsv);
const orders1 = processGrid(grid1);
console.log('Canonical Orders parsed:', orders1.length);
console.log('Sample Canonical Order 0:', orders1[0]);

const grid2 = parseCsvToGrid(brazilianCsv);
const orders2 = processGrid(grid2);
console.log('Brazilian Orders parsed:', orders2.length);
console.log('Sample Brazilian Order 0:', orders2[0]);
console.log('Sample Brazilian Order 2 (1.850,00 kg):', orders2[2]);
