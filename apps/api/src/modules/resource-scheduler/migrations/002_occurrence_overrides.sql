CREATE TABLE IF NOT EXISTS resource_booking_series_occurrence_overrides (
  series_id UUID NOT NULL REFERENCES resource_booking_series(id) ON DELETE CASCADE,
  occurrence_date DATE NOT NULL,
  resource_booking_id UUID NOT NULL UNIQUE REFERENCES resource_bookings(id) ON DELETE CASCADE,
  updated_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS resource_booking_occurrence_overrides_booking_idx
  ON resource_booking_series_occurrence_overrides(resource_booking_id);
