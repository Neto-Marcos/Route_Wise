-- Identifica claramente a pessoa que realizou o Pix, inclusive quando o
-- pagamento é baixado pelo escritório em nome de outra pessoa.
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS paid_by_name text;
