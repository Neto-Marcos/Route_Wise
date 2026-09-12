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

const COLUMN_ALIASES = {
  clientName: [
    'cliente', 'destinatario', 'razao social', 'nome', 'comprador',
    'client', 'recipient', 'customer', 'destinatario cliente', 'cliente destinatario',
    'consignatario', 'empresa', 'loja', 'recebedor', 'nome do cliente'
  ],
  address: [
    'endereco', 'logradouro', 'endereco completo', 'rua', 'local',
    'local de entrega', 'endereco de entrega', 'address', 'entrega',
    'destinatario endereco', 'rua de entrega'
  ],
  city: [
    'cidade', 'municipio', 'destino', 'city', 'cidade destino',
    'cidade entrega', 'cidade de entrega', 'municipio destino', 'municipio de entrega',
    'localidade', 'praca'
  ],
  uf: [
    'uf', 'estado', 'state', 'sigla uf', 'regiao', 'uf destino', 'uf entrega'
  ],
  orderId: [
    'pedido', 'numero pedido', 'no pedido', 'num pedido', 'numero do pedido',
    'order id', 'order', 'order id', 'id pedido', 'nf', 'nfe', 'nota fiscal',
    'danfe', 'chave nf', 'chave nfe', 'documento', 'romaneio', 'doc'
  ],
  products: [
    'produto', 'produtos', 'descricao', 'conteudo', 'mercadoria',
    'mercadorias', 'description', 'itens descricao', 'tipo de carga', 'carga'
  ],
  volumeM3: [
    'cubagem m3', 'cubagem', 'volume m3', 'vol m3', 'm3', 'cbm',
    'metragem cubica', 'cubagem total', 'volume cubico'
  ],
  weightKg: [
    'peso kg', 'peso', 'peso bruto', 'peso liquido', 'peso total',
    'kg', 'weight', 'peso bruto kg', 'peso liq kg', 'peso liquido kg'
  ],
  boxes: [
    'volumes', 'qtd volumes', 'quantidade de volumes', 'caixas', 'cx',
    'cxs', 'boxes', 'qty', 'quantidade', 'qtd', 'qtde', 'itens', 'pacotes', 'unidades'
  ],
  lat: [
    'lat', 'latitude', 'lat entrega', 'coord y', 'y'
  ],
  lng: [
    'lng', 'lon', 'long', 'longitude', 'lng entrega', 'coord x', 'x'
  ]
};

function matchColumns(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping = {};
  const matchedHeaderIndices = new Set();

  // Try exact alias match first in order of specificity
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (const alias of aliases) {
      if (mapping[field] !== undefined) break;
      for (let i = 0; i < normalizedHeaders.length; i++) {
        if (matchedHeaderIndices.has(i)) continue;
        const h = normalizedHeaders[i];
        if (h === alias) {
          mapping[field] = i;
          matchedHeaderIndices.add(i);
          break;
        }
      }
    }
  }

  // Fallback: contains match for unmatched fields
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (mapping[field] !== undefined) continue;
    for (const alias of aliases) {
      if (mapping[field] !== undefined) break;
      for (let i = 0; i < normalizedHeaders.length; i++) {
        if (matchedHeaderIndices.has(i)) continue;
        const h = normalizedHeaders[i];
        if (h.includes(alias) || alias.includes(h)) {
          mapping[field] = i;
          matchedHeaderIndices.add(i);
          break;
        }
      }
    }
  }

  return { mapping, normalizedHeaders };
}

// Test canonical header from spec
const canonicalHeaders = ['Pedido', 'Cliente', 'Endereço', 'Cidade', 'UF', 'Cubagem m3', 'Peso kg', 'Volumes', 'Produtos'];
console.log('Canonical match:', matchColumns(canonicalHeaders).mapping);

// Test TOTVS / SAP alternate headers
const sapHeaders = ['No Pedido', 'Razão Social', 'Logradouro', 'Município', 'Estado', 'Cubagem (m³)', 'Peso Bruto (kg)', 'Qtd Caixas', 'Descrição'];
console.log('SAP/TOTVS match:', matchColumns(sapHeaders).mapping);
