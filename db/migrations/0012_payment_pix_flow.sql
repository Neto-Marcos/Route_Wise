-- Dados de Pix e comprovação de quitação das solicitações de pagamento.
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS pix_key text;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS pix_qr_url text;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS payment_receipt_url text;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS paid_by uuid REFERENCES dispatchers(id) ON DELETE SET NULL;
