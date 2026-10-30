CREATE TABLE IF NOT EXISTS eventdesk_inspection_schedules (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  asset_id UUID,
  unit_id UUID,
  interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 3650),
  next_due_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  CHECK ((asset_id IS NULL) <> (unit_id IS NULL)),
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id, department_id) REFERENCES eventdesk_asset_units(id, department_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_inspection_schedule_asset_idx ON eventdesk_inspection_schedules (department_id,asset_id) WHERE asset_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_inspection_schedule_unit_idx ON eventdesk_inspection_schedules (department_id,unit_id) WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS eventdesk_inspection_due_idx ON eventdesk_inspection_schedules (next_due_date) WHERE active=true;

CREATE TABLE IF NOT EXISTS eventdesk_service_tickets (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  unit_id UUID,
  inspection_schedule_id UUID,
  maintenance_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('repair','inspection')),
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 160),
  fault TEXT NOT NULL DEFAULT '' CHECK (char_length(fault) <= 4000),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_parts','completed','cancelled')),
  owner_user_id UUID,
  diagnosis TEXT NOT NULL DEFAULT '' CHECK (char_length(diagnosis) <= 4000),
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  work_performed TEXT NOT NULL DEFAULT '' CHECK (char_length(work_performed) <= 8000),
  labor_minutes INTEGER NOT NULL DEFAULT 0 CHECK (labor_minutes BETWEEN 0 AND 1000000),
  labor_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (labor_cost_cents BETWEEN 0 AND 1000000000),
  parts_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (parts_cost_cents BETWEEN 0 AND 1000000000),
  due_date DATE,
  inspection_due_date DATE,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, department_id),
  FOREIGN KEY (asset_id, department_id) REFERENCES eventdesk_assets(id, department_id) ON DELETE RESTRICT,
  FOREIGN KEY (unit_id, department_id) REFERENCES eventdesk_asset_units(id, department_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS eventdesk_service_tickets_asset_idx ON eventdesk_service_tickets (department_id,asset_id,opened_at DESC);
CREATE INDEX IF NOT EXISTS eventdesk_service_tickets_queue_idx ON eventdesk_service_tickets (department_id,status,priority,due_date);
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_service_tickets_inspection_once_idx ON eventdesk_service_tickets (department_id,inspection_schedule_id,inspection_due_date) WHERE inspection_schedule_id IS NOT NULL;

ALTER TABLE eventdesk_asset_maintenance ADD COLUMN IF NOT EXISTS service_ticket_id UUID;
CREATE TABLE IF NOT EXISTS eventdesk_service_ticket_attachments (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  ticket_id UUID NOT NULL,
  file_name TEXT NOT NULL CHECK (char_length(trim(file_name)) BETWEEN 1 AND 240),
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg','image/png','application/pdf')),
  file_data BYTEA NOT NULL,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (ticket_id, department_id) REFERENCES eventdesk_service_tickets(id, department_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eventdesk_service_ticket_attachments_idx ON eventdesk_service_ticket_attachments (department_id,ticket_id,created_at);
