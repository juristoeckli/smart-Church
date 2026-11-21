CREATE TABLE IF NOT EXISTS overview_location_welcome (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  heading TEXT NOT NULL CHECK (char_length(heading) <= 100),
  subtitle TEXT NOT NULL CHECK (char_length(subtitle) <= 300)
);
