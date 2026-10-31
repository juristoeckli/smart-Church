ALTER TABLE sync_site_redundancy
  ADD COLUMN IF NOT EXISTS last_replica_digest TEXT
    CHECK (last_replica_digest IS NULL OR last_replica_digest ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS last_replica_manifest JSONB;

CREATE OR REPLACE FUNCTION initialize_site_redundancy_state() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_site_redundancy(department_id,role,primary_installation_id)
  VALUES(NEW.id,'primary',NEW.installation_id)
  ON CONFLICT(department_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS departments_initialize_redundancy ON departments;
CREATE TRIGGER departments_initialize_redundancy
  AFTER INSERT ON departments
  FOR EACH ROW EXECUTE FUNCTION initialize_site_redundancy_state();
