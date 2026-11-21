CREATE TABLE IF NOT EXISTS overview_location_layouts (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  widget_order JSONB NOT NULL CHECK (jsonb_typeof(widget_order) = 'array'),
  visible_widgets JSONB NOT NULL CHECK (jsonb_typeof(visible_widgets) = 'array')
);
