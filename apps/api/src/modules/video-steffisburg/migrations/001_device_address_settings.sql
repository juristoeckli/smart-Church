CREATE TABLE IF NOT EXISTS video_device_address_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  default_addresses JSONB NOT NULL,
  addresses JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
