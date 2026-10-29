CREATE TABLE IF NOT EXISTS installations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  is_current BOOLEAN NOT NULL DEFAULT TRUE UNIQUE CHECK (is_current),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO installations (is_current) VALUES (TRUE)
ON CONFLICT (is_current) DO NOTHING;

ALTER TABLE departments ADD COLUMN IF NOT EXISTS installation_id UUID;

UPDATE departments
   SET installation_id = (SELECT id FROM installations WHERE is_current = TRUE)
 WHERE installation_id IS NULL;

ALTER TABLE departments ALTER COLUMN installation_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'departments_installation_id_fkey'
       AND conrelid = 'departments'::regclass
  ) THEN
    ALTER TABLE departments
      ADD CONSTRAINT departments_installation_id_fkey
      FOREIGN KEY (installation_id) REFERENCES installations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS departments_installation_idx ON departments (installation_id, id);
