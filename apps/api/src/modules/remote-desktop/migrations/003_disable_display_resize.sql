ALTER TABLE remote_desktop_destinations
  ADD COLUMN IF NOT EXISTS disable_display_resize BOOLEAN NOT NULL DEFAULT false;
