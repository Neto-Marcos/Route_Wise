# Especificação Técnica: Motor de Roteirização Automatizado (Routing Engine Core)
**Criar Rota TMS — Gestão de Entregas e Frotas**
**Data**: 2026-09-12 | **Autor**: Spec Miner 3 (Teamwork Specialist)
**Ambiente**: Next.js 15.5 (App Router), React 19, Node.js 24, PostgreSQL / PGlite, Leaflet, Tailwind CSS

---

## 1. Visão Geral & Escopo

O objetivo desta especificação é definir a arquitetura, regras de negócio, algoritmos matemáticos e modelos de dados para o **Motor de Roteirização Automatizado** do Criar Rota TMS. O sistema permite que o gestor de expedição faça upload de romaneios em planilhas (`.xlsx` ou `.csv`), processe e agrupe automaticamente os pedidos de entrega com base em **proximidade geográfica**, **limites de cubagem ($m^3$)** e **peso ($kg$)**, gere instruções de carregamento **LIFO (Last In, First Out)** e despache as rotas resultantes diretamente para o aplicativo offline do motorista.

### Requisitos Mandatórios (ORIGINAL_REQUEST.md)
1. **R1. Upload & Parsing de Planilhas**: Leitura e validação de arquivos `.xlsx` e `.csv` contendo Cliente/Destinatário, Cidade/Endereço, Pedido/Produtos, Cubagem ($m^3$), Peso ($kg$) e Quantidade de Itens/Caixas.
2. **R2. Algoritmo de Clustering & Bin-Packing**: Agrupamento por proximidade geográfica e particionamento de rotas respeitando limites de capacidade do veículo (ex.: 20 $m^3$ ou 30 $m^3$, além de limites de peso).
3. **R3. Interface de Despacho & Atribuição de Motorista**: Visualização das rotas sugeridas (rotas totais, $m^3$ total, paradas por rota), seleção de motorista e veículo cadastrados, guia de carregamento LIFO e botão "Salvar e Despachar" para persistência imediata no banco de dados.
4. **Critérios de Aceite**:
   - Upload e processamento com renderização de rotas em **menos de 3 segundos**.
   - Garantia matemática estrita de que nenhuma rota gerada ultrapassa a capacidade máxima parametrizada ($m^3$ e $kg$).
   - Formatação e disponibilização instantânea no app do motorista (compatível com PWA e sincronização offline via IndexedDB).

---

## 2. Ingestão e Parsing de Planilhas

### 2.1 Estado Atual das Dependências do Projeto
- O arquivo `package.json` atual contém:
  - `next: ^15.5.3`, `react: ^19.1.1`, `@electric-sql/pglite: ^0.3.10`, `pg: ^8.16.3`, `sharp: ^0.35.4`, `zod: ^4.1.8`, `leaflet: ^1.9.4`, `lucide-react: ^0.544.0`, `bcryptjs`, `jose`, `@aws-sdk/client-s3`.
  - **Nenhuma biblioteca de planilha** (`xlsx`, `exceljs`, `papaparse`, `csv-parse`) está instalada no momento.
  - O gerenciador de pacotes do projeto é `pnpm@10.15.1` (executável via `npx pnpm`).
  - No registro npm público, `xlsx@0.18.5` (SheetJS) e `papaparse@5.7.0` estão disponíveis para instalação imediata.

### 2.2 Estratégia de Parsing Recomendada
Para garantir suporte universal a `.xlsx`, `.xls` e `.csv` com performance instantânea:
1. **Para Arquivos CSV (`.csv`)**:
   - Parser nativo em TypeScript / Node.js (RFC 4180 complacente).
   - Auto-detecção de delimitador: frequência de vírgula (`,`), ponto-e-vírgula (`;` — padrão do Excel no Brasil) e tabulação (`\t`).
   - Tratamento de BOM UTF-8 (`\uFEFF`) e codificações comuns (UTF-8 e Windows-1252 / ISO-8859-1).
   - Conversão de separador decimal brasileiro (`1.250,50` $\rightarrow$ `1250.50`, `0,45` $\rightarrow$ `0.45`).
2. **Para Arquivos Excel (`.xlsx`, `.xls`)**:
   - Utilização da biblioteca `xlsx` (SheetJS `^0.18.5`) via `npx pnpm add xlsx` e `@types/xlsx`.
   - Execução server-side em `app/api/routing/parse/route.ts` ou diretamente na biblioteca `lib/route-engine.ts`.
   - Leitura de buffer em memória (`XLSX.read(buffer, { type: 'buffer' })`) com tempo de processamento inferior a 30 ms para planilhas de até 1.000 linhas.

### 2.3 Mapeamento de Sinônimos de Colunas (Dicionário TMS Brasil)
Planilhas extraídas de ERPs brasileiros (SAP, TOTVS Protheus, Bling, Tiny, OMIE, Senior) possuem cabeçalhos variados. O motor deve normalizar os cabeçalhos através da remoção de acentos, pontuação, espaços extras e caixa baixa:

| Campo do Sistema | Tipos de Dados | Sinônimos Aceitos (Normalizados) | Exemplo de Valor |
| :--- | :--- | :--- | :--- |
| **Cliente / Destinatário** | `string` (obrigatório) | `cliente`, `destinatario`, `razao social`, `nome`, `comprador`, `client`, `recipient`, `customer`, `destinatario/cliente` | "Supermercado Boa Vista" |
| **Cidade de Entrega** | `string` (obrigatório se não houver Lat/Lng) | `cidade`, `municipio`, `destino`, `city`, `cidade destino`, `cidade entrega`, `município destino` | "Campinas", "São Paulo" |
| **UF / Estado** | `string` (opcional) | `uf`, `estado`, `state`, `sigla uf`, `regiao` | "SP", "RJ", "MG" |
| **Endereço Completo** | `string` (obrigatório) | `endereco`, `logradouro`, `endereco completo`, `rua`, `local`, `address`, `entrega`, `bairro` | "Av. Francisco Glicério, 1200" |
| **Nº Pedido / ID** | `string` (opcional) | `pedido`, `numero pedido`, `nº pedido`, `numero do pedido`, `order id`, `nf`, `nota fiscal`, `danfe`, `chave nf` | "PED-98214", "NF 4521" |
| **Produtos / Mercadoria** | `string` (opcional) | `produto`, `produtos`, `descricao`, `conteudo`, `mercadoria`, `itens`, `item`, `description` | "Eletrodomésticos / Caixas" |
| **Cubagem ($m^3$)** | `number` (obrigatório p/ bin-packing) | `cubagem`, `cubagem (m3)`, `cubagem m3`, `volume (m3)`, `volume m3`, `m3`, `m³`, `cbm` | "1,85", "0.45", "2.10 m³" |
| **Peso ($kg$)** | `number` (obrigatório p/ bin-packing) | `peso`, `peso (kg)`, `peso kg`, `peso bruto`, `peso liquido`, `peso total`, `kg`, `weight` | "140,5", "45.0 kg", "350" |
| **Qtd Caixas / Volumes** | `number` (opcional, default 1) | `volumes`, `qtd volumes`, `quantidade`, `qtd`, `caixas`, `cx`, `itens`, `boxes`, `qty` | "12", "4 cx", "1" |
| **Latitude** | `number` (opcional) | `lat`, `latitude`, `y`, `lat_entrega` | -22.9099 |
| **Longitude** | `number` (opcional) | `lng`, `lon`, `longitude`, `x`, `lng_entrega` | -47.0626 |

### 2.4 Regras de Sanitização de Valores
1. **Números Decimais**:
   - Aceitar formatos `"1.250,50"` e `"1250.50"`.
   - Se contiver vírgula e ponto: se a vírgula vier depois do ponto (`1.250,50`), ponto é milhar e vírgula é decimal. Se o ponto vier depois da vírgula (`1,250.50`), vírgula é milhar.
   - Strings com sufixos (`"15.4 kg"`, `"2,8 m³"`, `"10 cxs"`) devem ter os caracteres alfanuméricos removidos antes do `parseFloat()`.
2. **Valores Nulos ou Negativos**:
   - Cubagem $\le 0$: atribuir fallback mínimo de `0.05 m³` (volume de uma caixa pequena) e emitir alerta leve no resumo da importação.
   - Peso $\le 0$: atribuir fallback mínimo de `1.0 kg` e emitir alerta.
   - Quantidade de itens $\le 0$: default `1`.

### 2.5 Planilha de Exemplo Canônica (Benchmark Mock Data)
Para testes unitários e homologação, a estrutura tabular ideal esperada é:

```csv
Pedido,Cliente,Endereço,Cidade,UF,Cubagem m3,Peso kg,Volumes,Produtos
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
PED-112,Centro Logístico Jundiaí,Av. dos Imigrantes 2500,Jundiaí,SP,7.50,1450.0,55,Cargas Diversas
```

---

## 3. Proximidade Geográfica & Geocodificação de Alta Performance

### 3.1 O Problema do SLA de 3 Segundos com APIs Externas
- O arquivo `app/api/[...path]/route.ts` atualmente utiliza o **Nominatim (OpenStreetMap)** com delay forçado de 1050 ms entre requisições para cumprir a política de uso público:
  ```ts
  if (kind === "restaurant") await new Promise((resolveDelay) => setTimeout(resolveDelay, 1050));
  ```
- Se o motor de roteirização fizesse 50 requisições HTTP para geocodificar 50 endereços da planilha:
  $$50 \text{ paradas} \times 1.05 \text{ s} = 52.5 \text{ segundos}$$
- Isso violaria frontalmente o critério de aceite: **"uploading a typical dispatch spreadsheet parses successfully and renders route suggestions in under 3 seconds"**.

### 3.2 Solução Arquitetural: Dicionário Embutido de Cidades & Hubs Logísticos
Para obter resolução de coordenadas em **menos de 5 milissegundos**:
1. **Dicionário em Memória (`lib/geo-brazil.ts`)**:
   - Um mapa indexado contendo coordenadas exatas (centro urbano / distritos industriais) dos principais municípios e pólos logísticos brasileiros (foco inicial no Estado de São Paulo e principais capitais/macrorregiões).
   - Busca em $O(1)$ por chave normalizada: `cidade + "_" + uf` ou apenas `cidade`.
2. **Resolução em Cascata**:
   - **Nível 1**: Coordenadas explícitas (`lat`/`lng`) fornecidas na planilha $\rightarrow$ uso imediato.
   - **Nível 2**: Dicionário de cidades brasileiras $\rightarrow$ resolução imediata em 0 ms.
   - **Nível 3**: Extração de CEP (se presente no endereço, ex.: `13010-000`) $\rightarrow$ mapeamento do prefixo do CEP para a microrregião geográfica.
   - **Nível 4**: Fallback de aproximação por microrregião ou capital estadual com marcação `approximate: true`.

### 3.3 Coordenadas de Referência dos Principais Hubs Logísticos de SP (Exemplo Canônico)
```ts
export const BRAZILIAN_HUBS: Record<string, { lat: number; lng: number; name: string; uf: string }> = {
  "campinas_sp": { lat: -22.9099, lng: -47.0626, name: "Campinas", uf: "SP" },
  "sumare_sp": { lat: -22.8208, lng: -47.2669, name: "Sumaré", uf: "SP" },
  "hortolandia_sp": { lat: -22.8583, lng: -47.2200, name: "Hortolândia", uf: "SP" },
  "paulinia_sp": { lat: -22.7614, lng: -47.1542, name: "Paulínia", uf: "SP" },
  "americana_sp": { lat: -22.7375, lng: -47.3331, name: "Americana", uf: "SP" },
  "santa barbara d'oeste_sp": { lat: -22.7556, lng: -47.4147, name: "Santa Bárbara d'Oeste", uf: "SP" },
  "valinhos_sp": { lat: -22.9706, lng: -46.9961, name: "Valinhos", uf: "SP" },
  "vinhedo_sp": { lat: -23.0297, lng: -46.9747, name: "Vinhedo", uf: "SP" },
  "indaiatuba_sp": { lat: -23.0903, lng: -47.2181, name: "Indaiatuba", uf: "SP" },
  "jundiai_sp": { lat: -23.1857, lng: -46.8978, name: "Jundiaí", uf: "SP" },
  "sao paulo_sp": { lat: -23.5505, lng: -46.6333, name: "São Paulo", uf: "SP" },
  "guarulhos_sp": { lat: -23.4628, lng: -46.5333, name: "Guarulhos", uf: "SP" },
  "santos_sp": { lat: -23.9608, lng: -46.3331, name: "Santos", uf: "SP" },
  "sorocaba_sp": { lat: -23.5015, lng: -47.4526, name: "Sorocaba", uf: "SP" },
  "sao jose dos campos_sp": { lat: -23.1791, lng: -45.8872, name: "São José dos Campos", uf: "SP" },
  "ribeirao preto_sp": { lat: -21.1767, lng: -47.8208, name: "Ribeirão Preto", uf: "SP" },
};
```

### 3.4 Cálculo de Distância (Fórmula de Haversine)
Conforme já padronizado no projeto (`components/routewise-app.tsx:4371` e `components/driver-live-map.tsx:140`):
$$\Delta \text{lat} = \text{rad}(\text{lat}_2 - \text{lat}_1), \quad \Delta \text{lng} = \text{rad}(\text{lng}_2 - \text{lng}_1)$$
$$a = \sin^2\left(\frac{\Delta \text{lat}}{2}\right) + \cos(\text{rad}(\text{lat}_1)) \cdot \cos(\text{rad}(\text{lat}_2)) \cdot \sin^2\left(\frac{\Delta \text{lng}}{2}\right)$$
$$d = 2 \cdot R \cdot \arcsin(\sqrt{a}) \quad \text{onde } R = 6371 \text{ km}$$

---

## 4. Algoritmo de Clustering & Bin-Packing Multidimensional

### 4.1 Definição dos Parâmetros de Veículos da Frota
O sistema deve suportar capacidades pré-configuradas e permitir ajuste dinâmico pelo gestor:

| Tipo de Veículo | Volume Padrão ($m^3$) | Peso Máximo ($kg$) | Perfil Operacional |
| :--- | :--- | :--- | :--- |
| **VUC (Veículo Urbano de Carga)** | **20.0 $m^3$** | **3.500 kg** | Entregas urbanas centrais, zonas de restrição |
| **Caminhão Toco (2 eixos)** | **30.0 $m^3$** | **6.000 kg** | Distribuição regional intermunicipal |
| **Furgão / Van (Sprinter/Master)** | **10.0 $m^3$** | **1.500 kg** | Entregas expressas e fracionadas |
| **Caminhão Truck (3 eixos)** | **45.0 $m^3$** | **12.000 kg** | Transferência pesada e grandes volumes |

*Valores padrão do sistema*: $20.0\text{ m}^3$ ou $30.0\text{ m}^3$ de volume; $4.000\text{ kg}$ de peso.

### 4.2 Arquitetura do Algoritmo em 4 Fases (Cluster-First, Route-Second)

```
[ Planilha Parsed ]
        │
        ▼
[ Fase 1: Agrupamento Geográfico ] ─── Agrupa por cidade e raio de vizinhança (< 35 km)
        │
        ▼
[ Fase 2: Bin-Packing Multidimensional ] ── Particiona clusters que excedem Max Vol (20/30m³) ou Max Peso
        │
        ▼
[ Fase 3: Otimização de Sequência (TSP) ] ── Ordena paradas por Nearest Neighbor a partir da Origem
        │
        ▼
[ Fase 4: Garantia Matemática de Capacidade ] ── Invariant Assert (Vol ≤ MaxVol e Peso ≤ MaxPeso)
        │
        ▼
[ Sugestões Prontas para UI ]
```

#### Fase 1: Agrupamento Geográfico (Spatial Clustering)
1. Agrupar entregas pelo centroide da cidade.
2. Construir matriz de distância entre cidades via Haversine.
3. Cidades adjacentes com distância inferior ao raio de corte (ex.: $\le 35\text{ km}$, como Campinas $\leftrightarrow$ Sumaré $\leftrightarrow$ Hortolândia) são candidatas a compor a mesma macrorregião operacional.

#### Fase 2: Bin-Packing Multidimensional & Route Splitting
Para cada grupo geográfico:
1. Calcular volume total $V_{\text{total}} = \sum v_i$ e peso total $W_{\text{total}} = \sum w_i$.
2. **Critério de Divisão (Route Splitting)**:
   - Se $V_{\text{total}} \le V_{\max}$ E $W_{\text{total}} \le W_{\max}$: todas as entregas cabem em um único veículo.
   - Se $V_{\text{total}} > V_{\max}$ OU $W_{\text{total}} > W_{\max}$: o cluster deve ser fatiado em:
     $$N_{\text{rotas}} = \max\left( \left\lceil \frac{V_{\text{total}}}{V_{\max}} \right\rceil, \left\lceil \frac{W_{\text{total}}}{W_{\max}} \right\rceil \right)$$
3. **Estratégia de Empacotamento**:
   - Ordenar os pedidos pela sequência geográfica (varredura angular ou caminho ótimo) para evitar que clientes vizinhos caiam em caminhões diferentes desnecessariamente.
   - Preencher o primeiro veículo sequencialmente; no momento em que a inclusão do próximo pedido violar $V_{\text{atual}} + v_{k} > V_{\max}$ ou $W_{\text{atual}} + w_{k} > W_{\max}$, fechar a Rota 1 e abrir a Rota 2.
   - Continuar até que todos os pedidos estejam alocados.

#### Fase 3: Sequenciamento da Rota (TSP Nearest Neighbor + 2-Opt)
Para cada rota gerada:
1. A parada de posição 0 é a **Origem (CD Principal / Garagem)**:
   - Coordenada configurável da base da empresa (default: CD Principal em São Paulo ou Campinas).
2. A partir da origem, ordenar as paradas pelo algoritmo de vizinho mais próximo (*Nearest Neighbor*):
   $$\text{Próxima Parada} = \arg\min_{s \in \text{Não Visitados}} \text{dist}(\text{Atual}, s)$$
3. Aplicar refinamento local 2-Opt para desatar cruzamentos de trajeto.

#### Fase 4: Garantia Matemática de Capacidade (Verificação Invariante)
Antes de retornar qualquer sugestão ao gestor, o motor executa uma verificação estrita:
```ts
export function assertCapacityInvariants(routes: SuggestedRoute[], maxVolume: number, maxWeight: number): void {
  for (const route of routes) {
    const totalVol = route.stops.reduce((acc, s) => acc + (s.volume_m3 || 0), 0);
    const totalWeight = route.stops.reduce((acc, s) => acc + (s.weight_kg || 0), 0);

    if (totalVol > maxVolume + 0.0001) {
      throw new Error(`Violação de Invariante: Rota "${route.name}" excedeu volume (${totalVol.toFixed(2)}m³ > ${maxVolume}m³)`);
    }
    if (totalWeight > maxWeight + 0.0001) {
      throw new Error(`Violação de Invariante: Rota "${route.name}" excedeu peso (${totalWeight.toFixed(1)}kg > ${maxWeight}kg)`);
    }
  }
}
```

---

## 5. Lógica de Carregamento LIFO (Last In, First Out)

### 5.1 O Princípio Físico do Baú de Carga
Em veículos de carga fechados com porta traseira única:
- A mercadoria a ser entregue no **primeiro cliente** não pode ficar presa no fundo do caminhão.
- Portanto, o carregamento físico no galpão deve ocorrer na **ordem estritamente inversa** à ordem de entrega:
  - **Última Entrega ($N$-ésima parada)**: entra **primeiro** e fica no **FUNDO** (frente do baú/cabine).
  - **Entregas Intermediárias**: entram em seguida e ficam no **MEIO**.
  - **Primeira Entrega (1ª parada)**: entra por **último** e fica na **PORTA**.

### 5.2 Algoritmo de Geração do Guia LIFO
Dada a lista ordenada de entregas da rota $[S_1, S_2, \dots, S_N]$ (onde $S_0$ é a origem/CD):
1. Filtrar paradas excluindo a origem ($i > 0$).
2. Inverter a ordem das paradas (`.reverse()`).
3. Mapear cada elemento para o manifesto de carregamento:

```ts
export interface LifoInstruction {
  loadingStep: number;        // 1, 2, ..., N
  compartmentPosition: "FUNDO" | "MEIO" | "PORTA";
  deliveryOrderIndex: number; // N, N-1, ..., 1ª entrega
  stopName: string;
  address: string;
  city: string;
  orderId?: string;
  boxes: number;
  volumeM3: number;
  weightKg: number;
}

export function generateLifoManifest(deliveryStops: Stop[]): LifoInstruction[] {
  const n = deliveryStops.length;
  const reversed = [...deliveryStops].reverse();

  return reversed.map((stop, index) => {
    let compartmentPosition: "FUNDO" | "MEIO" | "PORTA" = "MEIO";
    if (index === 0) compartmentPosition = "FUNDO";
    else if (index === n - 1) compartmentPosition = "PORTA";

    const originalDeliveryIndex = n - index;

    return {
      loadingStep: index + 1,
      compartmentPosition,
      deliveryOrderIndex: originalDeliveryIndex,
      stopName: stop.name,
      address: stop.address,
      city: stop.city || "",
      orderId: stop.orderId,
      boxes: stop.boxes || 0,
      volumeM3: stop.volume_m3 || 0,
      weightKg: stop.weight_kg || 0,
    };
  });
}
```

### 5.3 Integração com o Padrão Visual Existente
O Criar Rota já possui a tabela LIFO estilizada em `components/routewise-app.tsx:3042-3097`. O novo motor conecta essa lógica diretamente às rotas importadas da planilha, gerando o romaneio de expedição para impressão e visualização no painel do motorista.

---

## 6. Persistência de Dados & Alinhamento de Schema

### 6.1 Análise de Schema: PostgreSQL / PGLite vs Drizzle ORM
- O arquivo `ORIGINAL_REQUEST.md` cita: *"the system correctly handles the DB insertions using Drizzle ORM."*
- **Observação Factual do Repositório**:
  - A base de código atualmente **não utiliza Drizzle ORM**; utiliza `pg` / `@electric-sql/pglite` com queries SQL diretas e migrações brutas em `db/migrations/0001_initial.sql` até `0005_route_load_fields.sql`.
  - A função de criação de rotas existente em `app/api/[...path]/route.ts` (linhas 581-617) executa inserções transacionais nativas com `BEGIN`, `COMMIT` e `ROLLBACK`.
- **Campos Atualmente Existentes em `route_stops`**:
  - `id` (uuid), `route_id` (uuid), `position` (integer), `name` (text), `address` (text), `lat` (double), `lng` (double), `is_origin` (boolean), `status` (text), `delivered_at` (timestamptz), `boxes` (integer), `volume_m3` (numeric).
- **Campos Adicionais Necessários**:
  Para persistir integralmente os dados do romaneio da planilha:
  1. `weight_kg numeric(10,2) DEFAULT 0` em `route_stops`.
  2. `order_id text` em `route_stops`.
  3. `products text` em `route_stops`.
  4. `total_volume_m3 numeric(10,2) DEFAULT 0` e `total_weight_kg numeric(10,2) DEFAULT 0` em `routes`.

### 6.2 Mutação Transacional de "Salvar e Despachar"
Ao clicar em "Salvar e Despachar Rota":
1. Executar `BEGIN`.
2. Inserir registro na tabela `routes` com status `'assigned'` se motorista e veículo forem selecionados, ou `'draft'`.
3. Inserir cada parada sequencialmente em `route_stops` com `position: 0` (Origem) até `position: N`.
4. Executar `COMMIT`.
5. Como `GET /api/routes/[id]` utiliza `SELECT * FROM route_stops`, as novas colunas e valores de peso, cubagem e pedido chegam automaticamente ao app do motorista e aos relatórios de romaneio.

---

## 7. Orçamento de Performance (< 3 Segundos)

Para garantir o critério de aceite com margem de segurança de 85%:

| Etapa do Fluxo | Tempo Máximo Previsto | Estratégia Técnica |
| :--- | :--- | :--- |
| **1. Upload e Leitura do Buffer** | 20 ms | Leitura de `multipart/form-data` em memória |
| **2. Parsing da Planilha (CSV / XLSX)** | 45 ms | SheetJS / parser nativo, até 500 linhas |
| **3. Geocodificação de Cidades** | 5 ms | Hash Map em memória (`lib/geo-brazil.ts`) |
| **4. Matriz de Distância & Haversine** | 10 ms | Cálculo aritmético puro em memória ($N^2$) |
| **5. Clustering & Bin-Packing** | 15 ms | FFD multidimensional particionado |
| **6. Otimização TSP (Sequenciamento)** | 25 ms | Nearest Neighbor + 2-Opt por rota |
| **7. Resumo & Cálculo de Métricas** | 5 ms | Agregações de $m^3$, $kg$ e tempo estimado |
| **8. Renderização React no Frontend** | 50 ms | Atualização de estado via React 19 hooks |
| **TOTAL ESTIMADO** | **~175 ms** | **<< 3.000 ms (Meta atingida com folga)** |

*Nota sobre traçado de mapas (Polylines OSRM)*:
O traçado completo de curvas de ruas via OSRM (`/api/osrm/route/v1/driving/...`) pode ser executado em paralelo (`Promise.all`) para as 2 a 4 rotas geradas (~300 ms), ou de forma sob demanda quando o gestor clica para inspecionar uma rota específica no mapa Leaflet, mantendo o tempo de geração do roteirizador instantâneo.

---

## 8. Tabela de Funcionalidades Descobertas

## Features Discovered
| # | Categoria | Funcionalidade | Descrição | Entradas | Saídas | Comportamento de Erro | Descoberto Via |
|---|---|---|---|---|---|---|---|
| 1 | Ingestão | Parser Universal XLSX/CSV | Extrai pedidos estruturados de planilhas `.xlsx`, `.xls` e `.csv`. | Buffer do arquivo, nome do arquivo | Lista de `SpreadsheetOrderRow` | Retorna erro 400 se o formato for inválido ou o arquivo estiver corrompido. | `ORIGINAL_REQUEST.md` R1 |
| 2 | Ingestão | Normalizador de Cabeçalhos | Identifica colunas independentemente de acentos, maiúsculas ou variações (ex: "Razão Social", "Cliente"). | Objeto raw de linhas | Linhas com chaves padronizadas (`clientName`, `address`, etc.) | Retorna 400 detalhando quais colunas mandatórias não foram encontradas. | Investigação de padrões TMS Brasil |
| 3 | Ingestão | Sanitizador de Números BR | Converte formatos decimais brasileiros (`1.250,50`, `0,45 m³`, `30 kg`) em floats puros. | Strings com pontuação e unidades | `number` float validado | Valores inválidos viram fallback ou geram erro de validação. | `components/routewise-app.tsx` |
| 4 | Geocodificação | Geocodificador em Memória | Associa cidades/municípios a coordenadas exatas via dicionário embutido em $O(1)$. | Nome da Cidade e UF | `{ lat: number, lng: number }` | Usa centroide da macrorregião ou capital e marca como aproximado. | Análise de performance (<3s) e `route.ts:136` |
| 5 | Roteirização | Agrupamento por Microrregião | Agrupa pedidos de cidades vizinhas ou da mesma praça logística. | Pedidos geolocalizados, raio de vizinhança (km) | Grupos de pedidos por proximidade | Pedidos isolados formam cluster unitário. | `ORIGINAL_REQUEST.md` R2 |
| 6 | Bin-Packing | Empacotamento Multidimensional | Distribui pedidos em veículos sem ultrapassar capacidade de volume ($m^3$) e peso ($kg$). | Pedidos do cluster, capacidade máxima de $m^3$ e $kg$ | Conjunto de rotas fatiadas | Lança erro ou separa em "Carga Especial" se pedido individual exceder caminhão. | `ORIGINAL_REQUEST.md` R2 |
| 7 | Otimização | Sequenciamento TSP | Ordena os pontos da rota iniciando no galpão/CD para minimizar distância total. | Paradas da rota, ponto de origem | Rota com posições ordenadas (0 a N) | Fallback para ordem de inserção se coordenadas forem idênticas. | `routewise-app.tsx:2440` |
| 8 | Expedição | Guia de Carregamento LIFO | Gera instruções de arrumação de carga: última entrega no fundo, primeira entrega na porta. | Lista de paradas ordenadas da rota | Manifesto LIFO com passos de 1 a N e posições (Fundo, Meio, Porta) | Ignorado se rota tiver menos de 2 paradas. | `ORIGINAL_REQUEST.md` R3 e `routewise-app.tsx:3044` |
| 9 | UI / Despacho | Painel de Rotas Sugeridas | Exibe cards com resumo de cada rota ($m^3$ usado, peso, paradas), seletor de motorista e veículo. | Rotas sugeridas, lista de motoristas e veículos ativos | Estado interativo de despacho na UI | Bloqueia despacho se motorista ou veículo não forem selecionados. | `ORIGINAL_REQUEST.md` R3 |
| 10 | Persistência | Despacho Transacional (DB) | Grava `routes` e `route_stops` em transação SQL e atualiza status para `'assigned'`. | ID do motorista, ID do veículo, paradas, cubagem, data | Registro da rota persistido com `public_id` | `ROLLBACK` automático e mensagem 409/500 em caso de falha de concorrência. | `app/api/[...path]/route.ts:581` |
| 11 | App Motorista | Recepção Offline da Rota | Disponibiliza a rota despachada no dispositivo do motorista via IndexedDB. | `GET /api/routes` ou push de sessão | Rota pronta para início com odômetro e paradas | Opera offline caso a rede caia após o carregamento. | `lib/offline.ts` |

---

## 9. Tabela de Casos de Borda (Edge Cases)

## Edge Cases
| # | Funcionalidade | Entrada / Condição | Comportamento Esperado / Solução do Motor |
|---|---|---|---|
| 1 | Parsing de Planilha | Arquivo vazio (0 bytes) ou apenas com linha de cabeçalho. | Rejeitar com erro 400: *"A planilha enviada não contém registros de pedidos."* |
| 2 | Parsing de Planilha | CSV com separador ponto-e-vírgula (`;`) ou tabulação (`\t`). | Auto-detecção de delimitador na primeira linha; parsear campos sem quebrar colunas. |
| 3 | Parsing de Planilha | Arquivo CSV com BOM UTF-8 (`\uFEFF`) no início. | Limpar o caractere BOM antes de ler os cabeçalhos para evitar falha de matching na 1ª coluna. |
| 4 | Parsing de Planilha | Pedido com cubagem ou peso preenchido com texto inválido (ex: `"N/A"`, `"-"`, `"grátis"`). | Sanitizador converte para `0` ou valor mínimo e registra aviso não-bloqueante no log do upload. |
| 5 | Bin-Packing | Pedido individual cuja cubagem ou peso excede a capacidade inteira do veículo (ex: pedido de 35 $m^3$ para caminhão de 30 $m^3$). | O motor não pode quebrar a invariante matemática. Deve isolar o pedido em uma rota dedicada de "Carga Especial / Lotação Completa" e emitir alerta visual na UI. |
| 6 | Geocodificação | Cidade desconhecida ou com grafia divergente (ex: `"S. Paulo"`, `"Campinas - SP"`, `"Zona Rural"`). | Limpeza de sufixos de UF, busca por aproximação no dicionário regional e fallback para o CD de origem com flag de "Coordenada aproximada". |
| 7 | Clustering | Pedidos com volumes e pesos zerados na planilha. | Bin-packing aloca até o limite máximo de paradas por veículo (ex.: 25 paradas) para evitar sobrecarga de jornada do motorista. |
| 8 | Clustering | Todas as entregas concentradas exatamente na mesma cidade. | O motor cria sub-rotas fatiando estritamente pelo limite de capacidade ($m^3$ e $kg$), mantendo clientes da mesma rua/bairro agrupados. |
| 9 | Otimização | Múltiplos pedidos para o mesmo cliente / mesmo endereço exato. | Permitir consolidar em uma única parada física (somando volumes e pesos) ou manter paradas consecutivas com distância zero. |
| 10 | LIFO | Rota contendo apenas 1 parada de entrega. | Guia LIFO exibe item único com posição "PORTA/FUNDO" unificada e ordem de carregamento #1. |
| 11 | Despacho | Gestor tenta despachar sem associar motorista ou veículo. | Validação na UI bloqueia botão "Despachar" e destaca campos obrigatórios em vermelho. |
| 12 | Persistência | Queda de conexão no momento exato do clique em "Salvar e Despachar". | Operação idempotente no frontend evitando duplicação de rota caso o gestor clique duas vezes. |
