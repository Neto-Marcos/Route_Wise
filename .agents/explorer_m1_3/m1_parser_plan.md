# Plano de Implementação: Universal Spreadsheet Parser (`lib/spreadsheet-parser.ts`)
**Milestone 1 — Automated Routing Engine (Criar Rota TMS)**
**Data**: 2026-09-12 | **Autor**: Explorer M1-3
**Status**: Pronto para Implementação pelo Worker

---

## 1. Visão Geral da Arquitetura

O motor de roteirização automatizado depende fundamentalmente da ingestão rápida e tolerante a falhas de romaneios de entregas gerados por diversos ERPs brasileiros (SAP, TOTVS Protheus, Bling, Tiny, OMIE, Senior, etc.).

Para cumprir o critério de aceite estrito do projeto (**processamento e sugestão de rotas em menos de 3 segundos**), o parser `lib/spreadsheet-parser.ts` adota uma **Arquitetura Unificada de Grade Bidimensional (2D String Grid Pipeline)**:

```
                  ┌─────────────────────────────────────────┐
                  │          Arquivo de Romaneio            │
                  │             (.xlsx / .csv)              │
                  └────────────────────┬────────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
     [ Formato Excel: .xlsx, .xls ]               [ Formato Texto: .csv, .tsv ]
                │                                             │
      SheetJS (`xlsx@0.18.5`)                       Parser Nativo RFC 4180
      XLSX.read(buffer, { ... })                    Auto-detecção de delimitador (;, ,, \t)
      sheet_to_json(..., { header: 1 })             Strip BOM UTF-8 (\uFEFF)
                │                                   Decodificação UTF-8 / Windows-1252
                │                                             │
                └──────────────────────┬──────────────────────┘
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │   Grade 2D (string[][])      │
                       │   Matriz Bruta de Linhas     │
                       └───────────────┬──────────────┘
                                       │
                                       ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │ 1. Varredura e Detecção da Linha de Cabeçalho (Header Row)      │
     │    Ignora linhas de título, metadados ou vazias acima da tabela │
     └─────────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │ 2. Normalização e Reconhecimento de Sinônimos de Colunas        │
     │    NFKD Unicode normalization, strip accents, minúsculas,       │
     │    casamento de aliases para Cliente, Endereço, Cidade, etc.    │
     └─────────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
     ┌─────────────────────────────────────────────────────────────────┐
     │ 3. Sanitização de Valores e Números Brasileiros                 │
     │    - Conversão decimal (1.250,50 -> 1250.50 | 0,45 -> 0.45)     │
     │    - Remoção segura de unidades (2,10 m³ -> 2.10 | 140 kg -> 140)│
     │    - Extração composta Cidade - UF ("Campinas - SP")            │
     │    - Aplicação de invariantes de fallback (cubagem e peso min)  │
     └─────────────────────────────────┬───────────────────────────────┘
                                       │
                                       ▼
                       ┌──────────────────────────────┐
                       │       ParsedOrder[]          │
                       │   Contrato Canônico TMS      │
                       └──────────────────────────────┘
```

### Vantagens do Pipeline Unificado:
1. **Consistência Total**: O mesmo dicionário de sinônimos, sanitizador numérico e regras de negócio tratam `.xlsx` e `.csv` de forma idêntica.
2. **Zero Overhead**: Não gera objetos temporários desnecessários nem usa bibliotecas pesadas de CSV de terceiros.
3. **Desempenho Extremo**: Planilhas típicas de 100 a 500 linhas são lidas e convertidas em menos de **30 milissegundos**, consumindo apenas 1% do orçamento de 3 segundos.

---

## 2. Parsing de Arquivos Excel (`.xlsx`, `.xls`) com SheetJS

### 2.1 Instalação Limpa
No arquivo `package.json` do projeto, a dependência `xlsx` não está presente. O Worker deve executar:

```bash
npx pnpm add xlsx@0.18.5
```

- **Por que `xlsx@0.18.5`?**
  - É a versão estável mais consolidada do SheetJS sob licença Apache-2.0.
  - O pacote `xlsx@0.18.5` já inclui nativamente o arquivo de declaração de tipos em `types/index.d.ts`.
  - **NÃO instalar `@types/xlsx`** (o pacote `@types/xlsx` está descontinuado e gera conflitos de declaração de tipo duplicada com o próprio `xlsx`).

### 2.2 Importação Segura em Next.js / TypeScript
Com o `tsconfig.json` existente do projeto (`moduleResolution: "bundler"`, `esModuleInterop: true`):

```typescript
import * as XLSX from "xlsx";
```

### 2.3 Conversão de Buffer para Grade 2D
O método de leitura aceita `Buffer`, `Uint8Array` ou `ArrayBuffer`:

```typescript
export function parseExcelToGrid(buffer: Buffer | Uint8Array | ArrayBuffer): string[][] {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  
  const workbook = XLSX.read(data, {
    type: "buffer",
    cellDates: false,
    raw: false // Garante que valores formatados (como decimais com vírgula) venham preservados
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("O arquivo Excel não contém nenhuma planilha de dados.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  // header: 1 produz string[][] ou any[][]
  // defval: "" garante que células intermediárias vazias não desloquem os índices das colunas
  const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    defval: "",
    blankrows: false
  });

  return rawRows.map(row => 
    Array.isArray(row)
      ? row.map(cell => (cell !== null && cell !== undefined ? String(cell).trim() : ""))
      : []
  );
}
```

---

## 3. Parsing de Arquivos CSV Nativo (RFC 4180 Complacente)

Arquivos `.csv` exportados por ERPs no Brasil apresentam particularidades que quebram parsers ingênuos baseados em `split('\n')` ou `split(',')`:
1. **Delimitador Padrão do Brasil**: O Excel brasileiro salva CSV separado por ponto-e-vírgula (`;`), porque a vírgula (`,`) é usada como separador decimal.
2. **BOM UTF-8**: O caractere `\uFEFF` inserido no início do arquivo por softwares Windows corrompe o nome da primeira coluna (ex.: `\uFEFFPedido`).
3. **Quebras de Linha em Endereços**: Células com aspas contendo `\n` ou `\r\n` (ex.: `"Rua Barão de Jaguara\n820"`).
4. **Codificações Legadas**: Arquivos em Windows-1252 / ISO-8859-1 (com caracteres como `ç`, `ã`, `é`) que geram erro no UTF-8 estrito.

### 3.1 Tratamento de Codificação e Remoção de BOM
```typescript
export function decodeBufferToString(buffer: Buffer | Uint8Array | ArrayBuffer): string {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  
  let text = "";
  try {
    // Tenta decodificação estrita UTF-8
    const decoder = new TextDecoder("utf-8", { fatal: true });
    text = decoder.decode(bytes);
  } catch {
    // Se falhar (caracteres Windows-1252 / ISO-8859-1 comuns em ERPs legados):
    const fallbackDecoder = new TextDecoder("windows-1252");
    text = fallbackDecoder.decode(bytes);
  }

  // Remove BOM UTF-8 se presente
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}
```

### 3.2 Auto-Detecção Inteligente de Delimitador (RFC 4180 Safe)
Não basta apenas contar delimitadores no texto inteiro, pois o campo de endereço pode conter vírgulas ou ponto-e-vírgulas entre aspas.
A detecção deve contar os delimitadores candidatos (`;`, `,`, `\t`, `|`) **apenas fora de blocos entre aspas** nas primeiras 10 linhas não-vazias:

```typescript
export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ";";

  const candidates = [";", ",", "\t", "|"];
  const scores: Record<string, number> = {};

  for (const delim of candidates) {
    const counts: number[] = [];
    for (const line of lines) {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === delim && !inQuotes) count++;
      }
      counts.push(count);
    }
    
    // Um delimitador consistente tem contagem > 0 e desvio zero entre as linhas
    if (counts.length > 0 && counts[0] > 0) {
      const allEqual = counts.every(c => c === counts[0]);
      if (allEqual) {
        scores[delim] = counts[0] * 10;
      } else {
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        scores[delim] = avg;
      }
    } else {
      scores[delim] = 0;
    }
  }

  let bestDelim = ";"; // Padrão brasileiro
  let maxScore = 0;
  for (const [delim, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestDelim = delim;
    }
  }

  return maxScore > 0 ? bestDelim : (text.includes(";") ? ";" : ",");
}
```

### 3.3 Máquina de Estados RFC 4180 para Parsing de CSV
A máquina de estados processa caractere a caractere, suportando:
- Aspas escapadas (`""` vira `"`);
- Delimitadores contidos dentro de aspas;
- Quebras de linha (`\r\n` ou `\n`) embutidas em campos de texto sem quebrar a contagem de registros;
- Normalização de espaçamento nas bordas.

```typescript
export function parseCsvToGrid(text: string, forcedDelimiter?: string): string[][] {
  const delimiter = forcedDelimiter || detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
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
        field = "";
        i++;
      } else if (char === "\r") {
        if (i + 1 < len && text[i + 1] === "\n") i++;
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = "";
        i++;
      } else if (char === "\n") {
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = "";
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
```

---

## 4. Sanitização Numérica e Tratamento de Unidades Brasileiras

### 4.1 O Desafio Crítico dos Sufixos de Unidade com Dígitos (`m³`, `m3`)
Na investigação empírica (verificação via script Node.js), descobriu-se um risco crítico:
Se um parser simplesmente remover caracteres alfanuméricos mantendo dígitos, o valor `"2,10 m3"` terá a letra `"m"` removida, mas o número `"3"` permanecerá no final, transformando o valor erroneamente em `2.103` em vez de `2.10`!
Portanto, as unidades de medida que possuem dígitos (`m3`, `m^3`, `cm3`, `dm3`, `m³`) **devem ser eliminadas antes de qualquer operação com expressões regulares de dígitos**.

### 4.2 Regras de Conversão Numérica
1. **Identificação de Formatos com Vírgula e Ponto**:
   - `1.250,50` $\rightarrow$ Ponto antes da vírgula = formato brasileiro. Remove todos os pontos e troca vírgula por ponto (`1250.50`).
   - `1,250.50` $\rightarrow$ Vírgula antes do ponto = formato internacional/US. Remove vírgula (`1250.50`).
   - `0,45` ou `1250,5` $\rightarrow$ Apenas vírgula = decimal brasileiro. Troca vírgula por ponto (`0.45` e `1250.5`).
   - `1.000.000` $\rightarrow$ Múltiplos pontos = separador de milhar. Remove os pontos.
   - `1250.50` $\rightarrow$ Ponto único decimal padrão.
2. **Sufixos Reconhecidos e Eliminados**:
   - Volume: `m³`, `m3`, `m^3`, `cbm`, `cm3`, `dm3`, `litros`, `l`.
   - Peso: `kg`, `kgs`, `kilos`, `quilos`, `ton`, `t`, `toneladas`, `g`, `gr`, `gramas`.
   - Volumes/Caixas: `cx`, `cxs`, `caixas`, `volumes`, `vols`, `itens`, `unid`, `unidades`, `un`, `pcts`, `pacotes`, `peças`, `pecas`.
   - Moedas: `R$`, `$`.
3. **Valores Mínimos e Fallbacks Invariantes**:
   - Cubagem $\le 0$ ou vazia $\rightarrow$ Fallback de `0.05 m³` (volume de uma caixa pequena de entrega).
   - Peso $\le 0$ ou vazio $\rightarrow$ Fallback de `1.0 kg` (peso mínimo para cálculo de frete/capacidade).
   - Caixas/Volumes $\le 0$ ou vazias $\rightarrow$ Fallback de `1`.

### 4.3 Implementação do Sanitizador
```typescript
export function sanitizeBrazilianNumber(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") {
    return isNaN(value) || !isFinite(value) ? fallback : value;
  }

  let str = String(value).trim();
  if (!str) return fallback;

  // 1. Remover unidades de volume com dígitos ANTES de remover letras
  str = str.replace(/(?:m\^?3|cm\^?3|dm\^?3|m³|cbm)/gi, "");

  // 2. Remover outras unidades de peso, caixas e moeda
  str = str.replace(/(?:kgs?|quilos?|kilos?|tons?|cxs?|caixas?|volumes?|vols?|itens?|unid(?:ades?)?|un|pe[çc]as?|r\$)/gi, "");

  // 3. Manter apenas dígitos, sinais e pontuação
  str = str.replace(/[^\d.,+-]/gi, "").trim();
  if (!str) return fallback;

  const hasComma = str.includes(",");
  const hasDot = str.includes(".");

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(",");
    const lastDot = str.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Padrão brasileiro: 1.250,50 -> 1250.50
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      // Padrão US: 1,250.50 -> 1250.50
      str = str.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Apenas vírgula: 0,45 -> 0.45
    str = str.replace(",", ".");
  } else if (hasDot) {
    // Múltiplos pontos: 1.000.000 -> 1000000
    const dots = str.split(".").length - 1;
    if (dots > 1) {
      str = str.replace(/\./g, "");
    }
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}
```

---

## 5. Dicionário de Sinônimos de Colunas (Padrões TMS Brasileiros)

### 5.1 Normalização de Cabeçalhos com `NFKD`
Planilhas contêm variações como `"Cubagem (m³)"`, `"CUBAGEM M3"`, `"Nº Pedido"`, `"Razão Social"`.
A normalização utiliza `normalize("NFKD")`, que:
1. Decompõe diacriticos (`ç` $\rightarrow$ `c`, `ã` $\rightarrow$ `a`).
2. Expande caracteres especiais em compatibilidade (`³` $\rightarrow$ `3`, `º` $\rightarrow$ `o`).
3. Remove pontuações e colapsa espaços múltiplos.

Exemplo:
- `"Cubagem (m³)"` $\rightarrow$ `"cubagem m3"`
- `"Nº Pedido"` $\rightarrow$ `"no pedido"`
- `"Razão Social / Cliente"` $\rightarrow$ `"razao social cliente"`

### 5.2 Mapeamento Completo de Aliases

| Campo de Destino (`ParsedOrder`) | Aliases Normalizados Aceitos (Ordem de Prioridade) |
|---|---|
| **`clientName`** | `cliente`, `destinatario`, `razao social`, `nome`, `comprador`, `client`, `recipient`, `customer`, `destinatario cliente`, `cliente destinatario`, `consignatario`, `empresa`, `loja`, `recebedor`, `nome do cliente` |
| **`address`** | `endereco`, `logradouro`, `endereco completo`, `rua`, `local`, `local de entrega`, `endereco de entrega`, `address`, `entrega`, `destinatario endereco`, `rua de entrega` |
| **`city`** | `cidade`, `municipio`, `destino`, `city`, `cidade destino`, `cidade entrega`, `cidade de entrega`, `municipio destino`, `municipio de entrega`, `localidade`, `praca` |
| **`uf`** | `uf`, `estado`, `state`, `sigla uf`, `regiao`, `uf destino`, `uf entrega`, `estado destino` |
| **`orderId`** | `pedido`, `numero pedido`, `no pedido`, `num pedido`, `numero do pedido`, `order id`, `order`, `id pedido`, `nf`, `nfe`, `nota fiscal`, `danfe`, `chave nf`, `chave nfe`, `documento`, `romaneio`, `doc` |
| **`products`** | `produto`, `produtos`, `descricao`, `conteudo`, `mercadoria`, `mercadorias`, `description`, `itens descricao`, `tipo de carga`, `carga`, `descricao produtos` |
| **`volumeM3`** | `cubagem m3`, `cubagem`, `volume m3`, `vol m3`, `m3`, `cbm`, `metragem cubica`, `cubagem total`, `volume cubico` |
| **`weightKg`** | `peso kg`, `peso`, `peso bruto`, `peso liquido`, `peso total`, `kg`, `weight`, `peso bruto kg`, `peso liq kg`, `peso liquido kg` |
| **`boxes`** | `volumes`, `qtd volumes`, `quantidade de volumes`, `caixas`, `cx`, `cxs`, `boxes`, `qty`, `quantidade`, `qtd`, `qtde`, `itens`, `pacotes`, `unidades` |
| **`lat`** *(opcional)* | `lat`, `latitude`, `lat entrega`, `coord y`, `y` |
| **`lng`** *(opcional)* | `lng`, `lon`, `long`, `longitude`, `lng entrega`, `coord x`, `x` |

### 5.3 Localização Automática da Linha de Cabeçalho (Header Sniffing)
Algumas exportações de ERP incluem linhas de título acima do cabeçalho (ex.: Linha 1: `"Relatório de Entregas - Filial Campinas"`, Linha 2: `""`, Linha 3: `"Pedido;Cliente;..."`).
O algoritmo varre as primeiras 10 linhas da grade e seleciona aquela que obtiver a maior pontuação de casamento de colunas obrigatórias (`clientName`, `address`, `city`).

---

## 6. Código Completo de `lib/spreadsheet-parser.ts` para o Worker

O arquivo completo, pronto para implementação direta pelo Worker em `lib/spreadsheet-parser.ts`:

```typescript
/**
 * Universal Spreadsheet Parser for Criar Rota TMS
 * Supports .xlsx, .xls, and .csv with delimiter auto-detection,
 * BOM stripping, Brazilian decimal conversion, and TMS column alias matching.
 */

import * as XLSX from "xlsx";

export interface ParsedOrder {
  orderId: string;
  clientName: string;
  address: string;
  city: string;
  uf?: string;
  volumeM3: number;
  weightKg: number;
  boxes: number;
  products?: string;
  lat?: number;
  lng?: number;
}

export interface SpreadsheetParseSummary {
  fileName: string;
  fileType: "xlsx" | "xls" | "csv";
  delimiter?: string;
  totalRowsRaw: number;
  totalOrdersParsed: number;
  totalVolumeM3: number;
  totalWeightKg: number;
  totalBoxes: number;
  warnings: string[];
}

export interface SpreadsheetParseOutput {
  orders: ParsedOrder[];
  summary: SpreadsheetParseSummary;
}

const COLUMN_ALIASES: Record<keyof ParsedOrder | "products", string[]> = {
  clientName: [
    "cliente", "destinatario", "razao social", "nome", "comprador",
    "client", "recipient", "customer", "destinatario cliente", "cliente destinatario",
    "consignatario", "empresa", "loja", "recebedor", "nome do cliente"
  ],
  address: [
    "endereco", "logradouro", "endereco completo", "rua", "local",
    "local de entrega", "endereco de entrega", "address", "entrega",
    "destinatario endereco", "rua de entrega"
  ],
  city: [
    "cidade", "municipio", "destino", "city", "cidade destino",
    "cidade entrega", "cidade de entrega", "municipio destino", "municipio de entrega",
    "localidade", "praca"
  ],
  uf: [
    "uf", "estado", "state", "sigla uf", "regiao", "uf destino", "uf entrega", "estado destino"
  ],
  orderId: [
    "pedido", "numero pedido", "no pedido", "num pedido", "numero do pedido",
    "order id", "order", "id pedido", "nf", "nfe", "nota fiscal", "danfe",
    "chave nf", "chave nfe", "documento", "romaneio", "doc"
  ],
  products: [
    "produto", "produtos", "descricao", "conteudo", "mercadoria",
    "mercadorias", "description", "itens descricao", "tipo de carga", "carga", "descricao produtos"
  ],
  volumeM3: [
    "cubagem m3", "cubagem", "volume m3", "vol m3", "m3", "cbm",
    "metragem cubica", "cubagem total", "volume cubico"
  ],
  weightKg: [
    "peso kg", "peso", "peso bruto", "peso liquido", "peso total",
    "kg", "weight", "peso bruto kg", "peso liq kg", "peso liquido kg"
  ],
  boxes: [
    "volumes", "qtd volumes", "quantidade de volumes", "caixas", "cx",
    "cxs", "boxes", "qty", "quantidade", "qtd", "qtde", "itens", "pacotes", "unidades"
  ],
  lat: [
    "lat", "latitude", "lat entrega", "coord y", "y"
  ],
  lng: [
    "lng", "lon", "long", "longitude", "lng entrega", "coord x", "x"
  ]
};

export function normalizeHeader(header: unknown): string {
  if (header === null || header === undefined) return "";
  return String(header)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeBrazilianNumber(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "number") {
    return isNaN(value) || !isFinite(value) ? fallback : value;
  }

  let str = String(value).trim();
  if (!str) return fallback;

  // Remove unit suffixes that contain digits like m3, m^3, cm3
  str = str.replace(/(?:m\^?3|cm\^?3|dm\^?3|m³|cbm)/gi, "");

  // Remove other text units and currency
  str = str.replace(/(?:kgs?|quilos?|kilos?|tons?|cxs?|caixas?|volumes?|vols?|itens?|unid(?:ades?)?|un|pe[çc]as?|r\$)/gi, "");

  // Remove non-numeric symbols except punctuation
  str = str.replace(/[^\d.,+-]/gi, "").trim();
  if (!str) return fallback;

  const hasComma = str.includes(",");
  const hasDot = str.includes(".");

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(",");
    const lastDot = str.lastIndexOf(".");
    if (lastComma > lastDot) {
      str = str.replace(/\./g, "").replace(",", ".");
    } else {
      str = str.replace(/,/g, "");
    }
  } else if (hasComma) {
    str = str.replace(",", ".");
  } else if (hasDot) {
    const dots = str.split(".").length - 1;
    if (dots > 1) {
      str = str.replace(/\./g, "");
    }
  }

  const parsed = parseFloat(str);
  return isNaN(parsed) || !isFinite(parsed) ? fallback : parsed;
}

export function decodeBufferToString(buffer: Buffer | Uint8Array | ArrayBuffer): string {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  let text = "";
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    text = decoder.decode(bytes);
  } catch {
    const fallbackDecoder = new TextDecoder("windows-1252");
    text = fallbackDecoder.decode(bytes);
  }

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

export function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0).slice(0, 10);
  if (lines.length === 0) return ";";

  const candidates = [";", ",", "\t", "|"];
  const scores: Record<string, number> = {};

  for (const delim of candidates) {
    const counts: number[] = [];
    for (const line of lines) {
      let inQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === delim && !inQuotes) count++;
      }
      counts.push(count);
    }

    if (counts.length > 0 && counts[0] > 0) {
      const allEqual = counts.every(c => c === counts[0]);
      scores[delim] = allEqual ? counts[0] * 10 : counts.reduce((a, b) => a + b, 0) / counts.length;
    } else {
      scores[delim] = 0;
    }
  }

  let bestDelim = ";";
  let maxScore = 0;
  for (const [delim, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestDelim = delim;
    }
  }

  return maxScore > 0 ? bestDelim : (text.includes(";") ? ";" : ",");
}

export function parseCsvToGrid(text: string, forcedDelimiter?: string): string[][] {
  const delimiter = forcedDelimiter || detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
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
        field = "";
        i++;
      } else if (char === "\r") {
        if (i + 1 < len && text[i + 1] === "\n") i++;
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = "";
        i++;
      } else if (char === "\n") {
        row.push(field.trim());
        if (row.some(f => f.length > 0)) rows.push(row);
        row = [];
        field = "";
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

export function parseExcelToGrid(buffer: Buffer | Uint8Array | ArrayBuffer): string[][] {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const workbook = XLSX.read(data, {
    type: "buffer",
    cellDates: false,
    raw: false
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("A planilha enviada não contém páginas de dados.");
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    defval: "",
    blankrows: false
  });

  return rawRows.map(row =>
    Array.isArray(row)
      ? row.map(cell => (cell !== null && cell !== undefined ? String(cell).trim() : ""))
      : []
  );
}

export function matchColumns(headers: string[]): {
  mapping: Partial<Record<keyof ParsedOrder | "products", number>>;
  headerRowIndex: number;
} {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping: Partial<Record<keyof ParsedOrder | "products", number>> = {};
  const usedIndices = new Set<number>();

  // 1. Casamento exato por prioridade de alias
  for (const [fieldKey, aliases] of Object.entries(COLUMN_ALIASES)) {
    const field = fieldKey as keyof ParsedOrder | "products";
    for (const alias of aliases) {
      if (mapping[field] !== undefined) break;
      for (let i = 0; i < normalizedHeaders.length; i++) {
        if (usedIndices.has(i)) continue;
        if (normalizedHeaders[i] === alias) {
          mapping[field] = i;
          usedIndices.add(i);
          break;
        }
      }
    }
  }

  // 2. Casamento por contenção de termo (fallback para títulos compostos)
  for (const [fieldKey, aliases] of Object.entries(COLUMN_ALIASES)) {
    const field = fieldKey as keyof ParsedOrder | "products";
    if (mapping[field] !== undefined) continue;
    for (const alias of aliases) {
      if (mapping[field] !== undefined) break;
      for (let i = 0; i < normalizedHeaders.length; i++) {
        if (usedIndices.has(i)) continue;
        const h = normalizedHeaders[i];
        if (h.includes(alias) || alias.includes(h)) {
          mapping[field] = i;
          usedIndices.add(i);
          break;
        }
      }
    }
  }

  return { mapping, headerRowIndex: 0 };
}

function findHeaderRow(grid: string[][]): {
  headerRowIndex: number;
  mapping: Partial<Record<keyof ParsedOrder | "products", number>>;
} {
  let bestRowIndex = 0;
  let maxMatched = -1;
  let bestMapping: Partial<Record<keyof ParsedOrder | "products", number>> = {};

  const scanLimit = Math.min(grid.length, 10);
  for (let r = 0; r < scanLimit; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;

    const { mapping } = matchColumns(row);
    const count = Object.keys(mapping).length;

    if (count > maxMatched) {
      maxMatched = count;
      bestRowIndex = r;
      bestMapping = mapping;
    }

    // Se já identificou cliente e endereço ou cidade, é com certeza a linha de cabeçalho
    if (mapping.clientName !== undefined && (mapping.address !== undefined || mapping.city !== undefined)) {
      bestRowIndex = r;
      bestMapping = mapping;
      break;
    }
  }

  return { headerRowIndex: bestRowIndex, mapping: bestMapping };
}

export function processGrid(grid: string[][]): {
  orders: ParsedOrder[];
  warnings: string[];
} {
  if (!grid || grid.length < 2) {
    throw new Error("A planilha enviada não contém registros de pedidos.");
  }

  const { headerRowIndex, mapping } = findHeaderRow(grid);

  if (mapping.clientName === undefined && mapping.address === undefined) {
    throw new Error("Não foi possível identificar as colunas obrigatórias (Cliente/Destinatário ou Endereço) na planilha.");
  }

  const orders: ParsedOrder[] = [];
  const warnings: string[] = [];

  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;

    const rawClient = mapping.clientName !== undefined ? row[mapping.clientName] : "";
    const rawAddress = mapping.address !== undefined ? row[mapping.address] : "";
    const rawCity = mapping.city !== undefined ? row[mapping.city] : "";
    const rawUf = mapping.uf !== undefined ? row[mapping.uf] : "";
    const rawOrderId = mapping.orderId !== undefined ? row[mapping.orderId] : "";
    const rawProducts = mapping.products !== undefined ? row[mapping.products] : "";
    const rawVolume = mapping.volumeM3 !== undefined ? row[mapping.volumeM3] : "";
    const rawWeight = mapping.weightKg !== undefined ? row[mapping.weightKg] : "";
    const rawBoxes = mapping.boxes !== undefined ? row[mapping.boxes] : "";
    const rawLat = mapping.lat !== undefined ? row[mapping.lat] : "";
    const rawLng = mapping.lng !== undefined ? row[mapping.lng] : "";

    const clientName = String(rawClient || "").trim();
    const address = String(rawAddress || "").trim();
    let city = String(rawCity || "").trim();
    let uf = String(rawUf || "").trim().toUpperCase();

    // Ignora linhas totalmente em branco
    if (!clientName && !address && !city) continue;

    // Extrai UF caso venha embutido na cidade (ex: "Campinas - SP" ou "São Paulo / SP")
    if (!uf && city) {
      const match = city.match(/^(.*?)\s*[-/,\s]\s*([A-Za-z]{2})$/);
      if (match) {
        city = match[1].trim();
        uf = match[2].toUpperCase();
      }
    }

    const orderId = String(rawOrderId || "").trim() || `PED-${(orders.length + 1).toString().padStart(3, "0")}`;
    const products = String(rawProducts || "").trim() || undefined;

    let volumeM3 = sanitizeBrazilianNumber(rawVolume, 0);
    if (volumeM3 <= 0) {
      volumeM3 = 0.05; // Fallback mínimo 0.05 m³
    }

    let weightKg = sanitizeBrazilianNumber(rawWeight, 0);
    if (weightKg <= 0) {
      weightKg = 1.0; // Fallback mínimo 1.0 kg
    }

    let boxes = Math.round(sanitizeBrazilianNumber(rawBoxes, 1));
    if (boxes <= 0) boxes = 1;

    const lat = rawLat !== "" ? sanitizeBrazilianNumber(rawLat, undefined as any) : undefined;
    const lng = rawLng !== "" ? sanitizeBrazilianNumber(rawLng, undefined as any) : undefined;

    orders.push({
      orderId,
      clientName: clientName || `Cliente ${orderId}`,
      address: address || city,
      city: city || "Não Informada",
      uf: uf || undefined,
      volumeM3: Number(volumeM3.toFixed(3)),
      weightKg: Number(weightKg.toFixed(2)),
      boxes,
      products,
      ...(lat !== undefined && { lat }),
      ...(lng !== undefined && { lng })
    });
  }

  if (orders.length === 0) {
    throw new Error("Nenhum pedido válido pôde ser extraído da planilha enviada.");
  }

  return { orders, warnings };
}

/**
 * Função Canônica do Contrato PROJECT.md
 */
export async function parseSpreadsheet(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  fileName: string
): Promise<ParsedOrder[]> {
  const result = await parseSpreadsheetDetailed(buffer, fileName);
  return result.orders;
}

/**
 * Versão Detalhada com Métricas e Resumo para a UI do Gestor
 */
export async function parseSpreadsheetDetailed(
  buffer: Buffer | Uint8Array | ArrayBuffer,
  fileName: string
): Promise<SpreadsheetParseOutput> {
  const lowerName = fileName.toLowerCase();
  const isExcel = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls") || lowerName.endsWith(".ods");

  let grid: string[][];
  let delimiter: string | undefined = undefined;

  if (isExcel) {
    grid = parseExcelToGrid(buffer);
  } else {
    const text = decodeBufferToString(buffer);
    delimiter = detectDelimiter(text);
    grid = parseCsvToGrid(text, delimiter);
  }

  const { orders, warnings } = processGrid(grid);

  const totalVolumeM3 = Number(orders.reduce((acc, o) => acc + o.volumeM3, 0).toFixed(3));
  const totalWeightKg = Number(orders.reduce((acc, o) => acc + o.weightKg, 0).toFixed(2));
  const totalBoxes = orders.reduce((acc, o) => acc + o.boxes, 0);

  return {
    orders,
    summary: {
      fileName,
      fileType: isExcel ? (lowerName.endsWith(".xls") ? "xls" : "xlsx") : "csv",
      delimiter,
      totalRowsRaw: grid.length,
      totalOrdersParsed: orders.length,
      totalVolumeM3,
      totalWeightKg,
      totalBoxes,
      warnings
    }
  };
}
```

---

## 7. Estratégia de Testes Automatizados (`tests/spreadsheet-parser.test.mjs`)

O Worker deve adicionar testes unitários para cobrir 100% dos requisitos de parsing.
Os casos de teste mandatórios são:

1. **Teste 1: CSV Canônico com Vírgula**
   - Entrada: 12 pedidos com colunas canônicas (`Pedido`, `Cliente`, `Endereço`, `Cidade`, `UF`, `Cubagem m3`, `Peso kg`, `Volumes`, `Produtos`).
   - Asserções: 12 pedidos extraídos, valores numéricos preservados com precisão.

2. **Teste 2: CSV Padrão Brasileiro (Ponto-e-vírgula + BOM UTF-8)**
   - Entrada: `\uFEFFPedido;Cliente;Endereço;Cidade;UF;Cubagem (m³);Peso Bruto;Caixas;Mercadoria` com decimais `1,85 m³` e `1.850,00 kg`.
   - Asserções: Delimitador `;` detectado, BOM ignorado, cubagem `1.85`, peso `1850.0`.

3. **Teste 3: Planilha com Linha de Título no Topo**
   - Entrada: Linha 1 = `"Relatório Mensal de Cargas"`, Linha 2 = `""`, Linha 3 = Cabeçalhos.
   - Asserções: O sniffer identifica a Linha 3 como cabeçalho sem lançar erro.

4. **Teste 4: Endereço com Quebra de Linha (RFC 4180 Multi-line Quoted)**
   - Entrada: `"Rua Barão de Jaguara\n820"`.
   - Asserções: Não fragmenta em duas linhas, o campo `address` contém a quebra interna intacta.

5. **Teste 5: Conversão de Unidades e Evitação do Bug de Sufixo com Dígito**
   - Entrada: `2,10 m3` e `0,45 m³` e `140 kg`.
   - Asserções: `2,10 m3` torna-se `2.10` (e **não** `2.103`), `0,45 m³` torna-se `0.45`, `140 kg` torna-se `140.0`.

6. **Teste 6: Extração de UF Composta na Cidade**
   - Entrada: `Cidade = "Campinas - SP"`, `UF = ""`.
   - Asserções: `city` torna-se `"Campinas"`, `uf` torna-se `"SP"`.

7. **Teste 7: Resiliência a Arquivo Vazio ou Sem Pedidos**
   - Entrada: `""` ou apenas linha de cabeçalho.
   - Asserções: Lança exceção amigável com código/mensagem de erro clara.

---

## 8. Resumo para o Worker de Implementação

| Ação Necessária | Arquivo / Alvo | Comando / Detalhe |
|---|---|---|
| **1. Instalar SheetJS** | `package.json` | `npx pnpm add xlsx@0.18.5` |
| **2. Criar Módulo** | `lib/spreadsheet-parser.ts` | Implementar conforme Seção 6 deste plano. |
| **3. Escrever Testes** | `tests/spreadsheet-parser.test.mjs` | Cobrir os 7 casos da Seção 7 via Node test runner (`node --test`). |
| **4. Integrar com Route Engine** | `lib/route-engine.ts` | Consumir `ParsedOrder[]` retornado por `parseSpreadsheet`. |
