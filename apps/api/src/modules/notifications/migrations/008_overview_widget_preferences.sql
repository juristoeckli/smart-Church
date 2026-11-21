CREATE TABLE IF NOT EXISTS overview_widget_preferences (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  widget_order JSONB NOT NULL DEFAULT '["stats","events","birthdays","anniversaries","groupAppointments","currentBookings","recentEventFacts"]'::jsonb CHECK (jsonb_typeof(widget_order) = 'array'),
  visible_widgets JSONB NOT NULL DEFAULT '["stats","events","birthdays","anniversaries","groupAppointments","currentBookings","recentEventFacts"]'::jsonb CHECK (jsonb_typeof(visible_widgets) = 'array'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id,user_id)
);
