-- Central operacional: metas por motorista, chat geral, leitura e notificações.
CREATE TABLE IF NOT EXISTS driver_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  month text NOT NULL,
  target_km numeric(10,2) NOT NULL DEFAULT 0,
  target_deliveries integer NOT NULL DEFAULT 0,
  target_sla numeric(5,2) NOT NULL DEFAULT 95,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, driver_id, month)
);

CREATE TABLE IF NOT EXISTS operation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK(sender_type IN ('dispatcher','driver')),
  sender_id text NOT NULL,
  sender_name text NOT NULL,
  message text NOT NULL,
  quick_tag text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operation_messages_company_time_idx ON operation_messages(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id uuid NOT NULL REFERENCES operation_messages(id) ON DELETE CASCADE,
  user_type text NOT NULL,
  user_id text NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id, user_type, user_id)
);

CREATE TABLE IF NOT EXISTS notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  recipient_type text NOT NULL,
  recipient_id text,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'queued',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_events_company_time_idx ON notification_events(company_id, created_at DESC);

-- Coordenadas confirmadas para cidades importadas de planilhas. O cache evita
-- repetir chamadas ao provedor cartográfico e torna o roteirizador auditável.
CREATE TABLE IF NOT EXISTS city_geocodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_normalized text NOT NULL,
  uf text NOT NULL DEFAULT '',
  display_name text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  source text NOT NULL DEFAULT 'nominatim',
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(city_normalized, uf)
);
