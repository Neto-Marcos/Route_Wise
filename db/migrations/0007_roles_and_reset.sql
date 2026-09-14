-- Migration 0007: Suporte aos 4 perfis (Admin, Criador de rotas, Escritorio, Motorista)

-- 1. Adiciona a coluna role aos dispatchers (se nao existir)
ALTER TABLE dispatchers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin';

-- IMPORTANT: migrations must never erase operational data. The former reset
-- statements were removed because this file is executed during deployments.
