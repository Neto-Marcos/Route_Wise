-- 0014_performance_indexes.sql
-- Índices compostos para otimização de consultas de escala e relatórios da torre de controle

-- Rotas por empresa e status (Torre de Controle e Histórico)
CREATE INDEX IF NOT EXISTS routes_company_status_idx
  ON routes(company_id, status, created_at DESC);

-- Paradas por rota e posição (Sequenciamento de Entregas)
CREATE INDEX IF NOT EXISTS route_stops_route_position_idx
  ON route_stops(route_id, position ASC);

-- Despachantes por empresa e ativo
CREATE INDEX IF NOT EXISTS dispatchers_company_active_idx
  ON dispatchers(company_id, active);

-- Motoristas por empresa e ativo
CREATE INDEX IF NOT EXISTS drivers_company_active_idx
  ON drivers(company_id, active);
