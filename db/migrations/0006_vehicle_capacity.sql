-- Adiciona capacidade de carga nos veículos
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS capacity_m3 numeric(10,2) DEFAULT 30.00;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS capacity_kg numeric(10,2) DEFAULT 10000.00;

-- Tabela de importações de roteirização (para rastreio do que foi importado)
CREATE TABLE IF NOT EXISTS route_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_at timestamptz NOT NULL DEFAULT now(),
  source_filename text,
  total_orders integer NOT NULL DEFAULT 0,
  total_routes integer NOT NULL DEFAULT 0,
  imported_by text,
  raw_config jsonb
);

-- Adiciona referência de importação nas rotas
ALTER TABLE routes ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES route_imports(id);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS total_volume_m3 numeric(10,2) DEFAULT 0;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS total_weight_kg numeric(10,2) DEFAULT 0;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS total_boxes integer DEFAULT 0;
ALTER TABLE routes ADD COLUMN IF NOT EXISTS lifo_loading_order jsonb;

-- Adiciona campos extras em route_stops para dados da carteira
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS client_name text;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS order_ids jsonb;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS weight_kg numeric(10,2) DEFAULT 0;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE route_stops ADD COLUMN IF NOT EXISTS loading_sequence integer;
