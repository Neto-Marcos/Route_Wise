-- Migration 0009: Analytics, Metas, Solicitações de Pagamento e Chat Operacional

-- 1. Metas mensais de KM e custos da empresa configuradas pelo ADM
CREATE TABLE IF NOT EXISTS company_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month text NOT NULL, -- formato YYYY-MM
  target_km numeric(10,2) NOT NULL DEFAULT 5000.00,
  target_deliveries integer NOT NULL DEFAULT 200,
  budget_fuel numeric(10,2) NOT NULL DEFAULT 0.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, month)
);

-- 2. Solicitações de pagamento / adiantamento ao ADM (com comprovantes e status)
CREATE TABLE IF NOT EXISTS payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES drivers(id) ON DELETE SET NULL,
  route_id uuid REFERENCES routes(id) ON DELETE SET NULL,
  category text NOT NULL DEFAULT 'adiantamento', -- 'adiantamento', 'combustivel', 'pedagio', 'reembolso', 'diaria'
  amount numeric(10,2) NOT NULL,
  description text NOT NULL,
  receipt_url text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'paid'
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES dispatchers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS payment_requests_comp_idx ON payment_requests(company_id, status, created_at DESC);

-- 3. Mensageria e Chat Rápido Operacional da Rota
CREATE TABLE IF NOT EXISTS route_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  sender_type text NOT NULL, -- 'dispatcher' ou 'driver'
  sender_name text NOT NULL,
  sender_id text NOT NULL,
  message text NOT NULL,
  quick_tag text, -- 'cheguei_cliente', 'atraso_doca', 'problema_mecanico', 'aviso_geral'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS route_messages_route_idx ON route_messages(route_id, created_at ASC);

-- 4. Inscrições de Notificações Web Push (PWA)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_type text NOT NULL, -- 'dispatcher' ou 'driver'
  user_id text NOT NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subs_comp_user_idx ON push_subscriptions(company_id, user_type, user_id);
