CREATE UNIQUE INDEX IF NOT EXISTS church_calendar_calendars_department_id_id_idx
  ON church_calendar_calendars(department_id,id);

CREATE TABLE IF NOT EXISTS church_calendar_appointment_templates (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL,
  calendar_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  subtitle TEXT NOT NULL DEFAULT '' CHECK (length(subtitle)<=240),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description)<=8000),
  place TEXT NOT NULL DEFAULT '' CHECK (length(place)<=200),
  url TEXT NOT NULL DEFAULT '' CHECK (length(url)<=1000),
  internal_only BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags)<=30),
  FOREIGN KEY (department_id,calendar_id) REFERENCES church_calendar_calendars(department_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS church_calendar_appointment_templates_name_idx
  ON church_calendar_appointment_templates(department_id,calendar_id,lower(name));
