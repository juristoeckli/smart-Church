CREATE TABLE church_calendar_signup_schedules (
  appointment_id uuid PRIMARY KEY REFERENCES church_calendar_appointments(id) ON DELETE CASCADE,
  lead_days integer NOT NULL CHECK (lead_days BETWEEN 0 AND 365),
  template_group_id uuid REFERENCES church_groups(id) ON DELETE CASCADE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);
