-- Migration 0007: Suporte aos 4 perfis (Admin, Criador de rotas, Escritorio, Motorista) e Reset do Banco de Dados

-- 1. Adiciona a coluna role aos dispatchers (se nao existir)
ALTER TABLE dispatchers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

-- 2. Limpeza/Reset de tabelas operacionais e de historico de rotas
DELETE FROM location_points;
DELETE FROM delivery_events;
DELETE FROM odometer_readings;
DELETE FROM route_stops;
DELETE FROM routes;
DELETE FROM sync_operations;
DELETE FROM audit_log;

-- Se existir a tabela route_imports do roteirizador automatico, limpa tambem
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'route_imports') THEN
    DELETE FROM route_imports;
  END IF;
END $$;
