-- Migration 0008: Superadmin Marcos e Empresa EU

INSERT INTO companies (code, name, active)
VALUES ('EU', 'Administração Geral', true)
ON CONFLICT (code) DO UPDATE SET name = 'Administração Geral', active = true;

DO $$
DECLARE
  v_company_id uuid;
  v_pass_hash text := '$2b$10$u8AsCoGaugqMRjZ1UP31Qeq3dRQ82zr.Ka05E4xcm8HRL3AgNGvri';
BEGIN
  SELECT id INTO v_company_id FROM companies WHERE code = 'EU' LIMIT 1;
  IF v_company_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM dispatchers WHERE company_id = v_company_id AND (lower(email) = 'marcos' OR lower(email) = 'marcos@eu.com')) THEN
      UPDATE dispatchers 
      SET role = 'superadmin', name = 'Marcos', email = 'marcos', password_hash = v_pass_hash, active = true 
      WHERE company_id = v_company_id AND (lower(email) = 'marcos' OR lower(email) = 'marcos@eu.com');
    ELSE
      INSERT INTO dispatchers (company_id, name, email, password_hash, role, active)
      VALUES (v_company_id, 'Marcos', 'marcos', v_pass_hash, 'superadmin', true);
    END IF;
  END IF;
END $$;
