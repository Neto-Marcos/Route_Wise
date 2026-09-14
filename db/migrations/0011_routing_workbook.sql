-- Carteira ativa: permanece disponível até a empresa enviar uma versão nova.
CREATE TABLE IF NOT EXISTS routing_workbooks (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text,
  file_data bytea,
  parsed_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES dispatchers(id) ON DELETE SET NULL
);
