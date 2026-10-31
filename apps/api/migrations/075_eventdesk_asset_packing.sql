ALTER TABLE eventdesk_assets
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS stock_unit_label TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS package_size INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS package_label TEXT NOT NULL DEFAULT 'case',
  ADD COLUMN IF NOT EXISTS package_rate_cents INTEGER;

ALTER TABLE eventdesk_assets
  ADD CONSTRAINT eventdesk_assets_description_check CHECK (char_length(description) <= 4000),
  ADD CONSTRAINT eventdesk_assets_stock_unit_label_check CHECK (char_length(trim(stock_unit_label)) BETWEEN 1 AND 32),
  ADD CONSTRAINT eventdesk_assets_package_size_check CHECK (package_size BETWEEN 1 AND 10000),
  ADD CONSTRAINT eventdesk_assets_package_label_check CHECK (char_length(trim(package_label)) BETWEEN 1 AND 32),
  ADD CONSTRAINT eventdesk_assets_package_rate_check CHECK (package_rate_cents IS NULL OR package_rate_cents BETWEEN 0 AND 100000000);

ALTER TABLE eventdesk_job_assets
  ADD COLUMN IF NOT EXISTS booking_quantity INTEGER,
  ADD COLUMN IF NOT EXISTS booking_unit_label TEXT,
  ADD COLUMN IF NOT EXISTS units_per_booking INTEGER,
  ADD COLUMN IF NOT EXISTS booking_rate_cents INTEGER;

UPDATE eventdesk_job_assets b
   SET booking_quantity = b.quantity,
       booking_unit_label = a.stock_unit_label,
       units_per_booking = 1,
       booking_rate_cents = b.daily_rate_cents
  FROM eventdesk_assets a
 WHERE a.id = b.asset_id AND a.department_id = b.department_id
   AND (b.booking_quantity IS NULL OR b.booking_unit_label IS NULL OR b.units_per_booking IS NULL OR b.booking_rate_cents IS NULL);

ALTER TABLE eventdesk_job_assets
  ALTER COLUMN booking_quantity SET NOT NULL,
  ALTER COLUMN booking_unit_label SET NOT NULL,
  ALTER COLUMN units_per_booking SET NOT NULL,
  ALTER COLUMN booking_rate_cents SET NOT NULL,
  ALTER COLUMN booking_quantity SET DEFAULT 1,
  ALTER COLUMN booking_unit_label SET DEFAULT 'unit',
  ALTER COLUMN units_per_booking SET DEFAULT 1,
  ALTER COLUMN booking_rate_cents SET DEFAULT 0,
  ADD CONSTRAINT eventdesk_job_assets_booking_quantity_check CHECK (booking_quantity BETWEEN 1 AND 100000),
  ADD CONSTRAINT eventdesk_job_assets_units_per_booking_check CHECK (units_per_booking BETWEEN 1 AND 10000),
  ADD CONSTRAINT eventdesk_job_assets_booking_unit_label_check CHECK (char_length(trim(booking_unit_label)) BETWEEN 1 AND 64),
  ADD CONSTRAINT eventdesk_job_assets_booking_rate_check CHECK (booking_rate_cents BETWEEN 0 AND 100000000),
  ADD CONSTRAINT eventdesk_job_assets_booking_units_match_check CHECK (quantity = booking_quantity * units_per_booking);
