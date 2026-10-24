ALTER TABLE presenter_output_sessions DROP CONSTRAINT IF EXISTS presenter_output_sessions_session_id_check;
ALTER TABLE presenter_output_sessions
  ADD CONSTRAINT presenter_output_sessions_session_id_check
  CHECK (session_id IN ('main', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5', 'aux6', 'aux7', 'aux8', 'aux9', 'aux10'));
