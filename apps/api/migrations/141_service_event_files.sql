CREATE UNIQUE INDEX IF NOT EXISTS service_events_department_id_id_idx ON service_events(department_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS stored_files_department_id_id_idx ON stored_files(department_id,id);

CREATE TABLE IF NOT EXISTS service_event_files (
  department_id UUID NOT NULL,
  event_id UUID NOT NULL,
  file_id UUID NOT NULL,
  attached_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  attached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,event_id,file_id),
  FOREIGN KEY (department_id,event_id) REFERENCES service_events(department_id,id) ON DELETE CASCADE,
  FOREIGN KEY (department_id,file_id) REFERENCES stored_files(department_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS service_event_files_file_idx ON service_event_files(department_id,file_id);
