# Criar Rota 1.0.0

Versão consolidada: [notas da entrega e validação](docs/releases/1.0.0.md).

Plataforma web e PWA voltada para **operações logísticas, roteirização automatizada de entregas, torre de controle de frota, gestão financeira de fretes e analytics comercial**.

---

## ✨ Principais Funcionalidades

- **🗺️ Motor de Roteirização Inteligente:**
  - Agrupamento espacial de entregas, cálculo de capacidade multidimensional (cubagem em $\text{m}^3$, peso em $\text{kg}$ e volumes) e sequenciamento otimizado de paradas (TSP Nearest Neighbor + 2-Opt).
  - Geração automática de **Manifesto de Carregamento LIFO** (*Fundo → Meio → Porta* do baú) para orientar a expedição.
- **📄 Importação Universal (Planilhas & NOTFIS):**
  - Leitura de planilhas `.xlsx`, `.csv` e arquivos EDI `NOTFIS` com normalização automática de colunas, tratamento de decimais no padrão brasileiro e validação de pedido mínimo por UF.
- **📡 Torre de Controle & Hub Operacional:**
  - Acompanhamento em tempo real das rotas em andamento, mapa de calor por cidade, chat operacional integrado entre base e motorista e comprovação de entrega com foto/assinatura (com fila offline).
- **📦 Rastreamento SSW Integrado:**
  - Consulta direta de status de cargas por Chave DANFE (44 dígitos), Nota Fiscal ou CNPJ.
- **💰 Gestão Financeira & Fretes:**
  - Fluxo de solicitação, aprovação e comprovante de pagamentos de frete/diárias via PIX.
- **📊 Dashboard Comercial & KPIs:**
  - Indicadores executivos de faturamento mensal, frete sobre faturamento, quilometragem rodada e desempenho da carteira.

---

## 🛠️ Stack Tecnológica

- **Frontend & Backend:** Next.js (App Router), React 19, TypeScript
- **Banco de Dados:** PostgreSQL (`pg` + suporte embarcado via `@electric-sql/pglite` para testes/dev)
- **Mapas & Geoprocessamento:** OpenStreetMap, Nominatim, OSRM, Leaflet
- **Infraestrutura:** Docker, Railway, PWA (Service Worker + suporte offline)

---

## 🚀 Como Executar Localmente

1. **Clone o repositório e instale as dependências:**
   ```bash
   npm install
   ```

2. **Configure as variáveis de ambiente:**
   Copie o arquivo `.env.example` para `.env` e ajuste as credenciais do banco PostgreSQL:
   ```bash
   cp .env.example .env
   ```

3. **Execute as migrações e inicie o servidor de desenvolvimento:**
   ```bash
   npm run dev
   ```
   Acesse `http://localhost:3000`.
