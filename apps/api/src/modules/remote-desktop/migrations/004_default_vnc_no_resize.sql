-- VNC servers on fixed-size control panels, including AMX panels, may not
-- support Guacamole's browser-driven display resize messages.
UPDATE remote_desktop_destinations
   SET disable_display_resize = true
 WHERE protocol = 'vnc'
   AND disable_display_resize = false;
