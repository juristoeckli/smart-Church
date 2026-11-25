ALTER TABLE church_calendar_appointment_images
  ADD COLUMN IF NOT EXISTS image_metadata JSONB NOT NULL DEFAULT '{"altText":"","credit":"","sourceUrl":"","focalX":50,"focalY":50,"aiGenerated":false}'::jsonb
    CHECK (jsonb_typeof(image_metadata)='object'),
  ADD COLUMN IF NOT EXISTS revision UUID NOT NULL DEFAULT gen_random_uuid();
