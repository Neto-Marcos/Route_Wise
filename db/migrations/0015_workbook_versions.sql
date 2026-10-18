-- Immutable snapshots; the existing per-company row remains the active projection.
CREATE TABLE workbook_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  filename text NOT NULL,
  content_type text,
  file_data bytea,
  parsed_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at timestamptz,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid REFERENCES dispatchers(id) ON DELETE SET NULL,
  file_hash text,
  item_count integer CHECK (item_count >= 0),
  order_count integer CHECK (order_count >= 0),
  competence text,
  legacy boolean NOT NULL DEFAULT false,
  UNIQUE(company_id,id)
);
ALTER TABLE routing_workbooks ADD COLUMN active_import_id uuid;
ALTER TABLE routing_workbooks ADD CONSTRAINT workbook_active_same_company
  FOREIGN KEY (company_id,active_import_id) REFERENCES workbook_imports(company_id,id);
CREATE INDEX workbook_imports_company_date ON workbook_imports(company_id,confirmed_at DESC);
-- Legacy timestamps were mutated by GET; do not fabricate original upload dates/counts.
WITH archived AS (
  INSERT INTO workbook_imports(company_id,filename,content_type,file_data,parsed_rows,uploaded_by,file_hash,legacy)
  SELECT company_id,filename,content_type,file_data,parsed_rows,uploaded_by,
    CASE WHEN file_data IS NULL THEN NULL ELSE encode(sha256(file_data),'hex') END,true
  FROM routing_workbooks RETURNING company_id,id
)
UPDATE routing_workbooks w SET active_import_id=a.id FROM archived a WHERE w.company_id=a.company_id;
