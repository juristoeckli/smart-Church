ALTER TABLE remote_desktop_destinations
  ADD COLUMN IF NOT EXISTS vnc_encodings TEXT;

ALTER TABLE remote_desktop_destinations
  ADD CONSTRAINT remote_desktop_vnc_encodings_length
  CHECK (vnc_encodings IS NULL OR length(vnc_encodings) <= 100);
