CREATE TABLE IF NOT EXISTS people_growth_config (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  steps JSONB NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
  mappings JSONB NOT NULL CHECK (jsonb_typeof(mappings) = 'array')
);
