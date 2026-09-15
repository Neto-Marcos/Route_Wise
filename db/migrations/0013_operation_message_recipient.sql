-- Mensagens da central podem ser gerais ou destinadas a um motorista.
ALTER TABLE operation_messages
  ADD COLUMN IF NOT EXISTS recipient_driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS operation_messages_recipient_idx
  ON operation_messages(company_id, recipient_driver_id, created_at DESC);
