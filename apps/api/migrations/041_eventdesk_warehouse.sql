ALTER TABLE eventdesk_assets
  ADD COLUMN IF NOT EXISTS barcode TEXT NOT NULL DEFAULT '' CHECK (char_length(barcode) <= 120);

CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_assets_department_barcode_idx
  ON eventdesk_assets (department_id, lower(barcode))
  WHERE barcode <> '';

ALTER TABLE eventdesk_job_assets
  ADD COLUMN IF NOT EXISTS checked_out_quantity INTEGER NOT NULL DEFAULT 0
  CHECK (checked_out_quantity BETWEEN 0 AND quantity);

UPDATE eventdesk_job_assets
   SET checked_out_quantity = quantity
 WHERE status = 'checked_out' AND checked_out_quantity = 0;
