ALTER TABLE remote_desktop_destinations
  ADD COLUMN IF NOT EXISTS vnc_color_depth SMALLINT;

ALTER TABLE remote_desktop_destinations
  ADD CONSTRAINT remote_desktop_vnc_color_depth_supported
  CHECK (vnc_color_depth IS NULL OR vnc_color_depth IN (8, 16, 24, 32));
