CREATE TABLE department_self_signup_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  confirmation_delay_minutes INTEGER NOT NULL DEFAULT 11 CHECK (confirmation_delay_minutes BETWEEN 1 AND 1440),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO department_self_signup_settings (department_id, enabled, confirmation_delay_minutes, updated_at)
SELECT department.id, COALESCE(settings.enabled, false), COALESCE(settings.confirmation_delay_minutes, 11), COALESCE(settings.updated_at, now())
  FROM departments department
  JOIN installations installation ON installation.id=department.installation_id AND installation.is_current=true
  LEFT JOIN installation_self_signup_settings settings ON settings.installation_id=installation.id
ON CONFLICT (department_id) DO NOTHING;

ALTER TABLE self_signup_requests ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE self_signup_requests DROP CONSTRAINT IF EXISTS self_signup_requests_email_key;
CREATE UNIQUE INDEX self_signup_requests_site_email_unique ON self_signup_requests(department_id, lower(email));
CREATE INDEX self_signup_requests_site_review_idx ON self_signup_requests(department_id, created_at)
  WHERE status IN ('pending_admin','approved_delivery_failed');

DROP TABLE installation_self_signup_settings;
