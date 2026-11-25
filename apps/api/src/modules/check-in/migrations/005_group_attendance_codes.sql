ALTER TABLE church_groups
  ADD COLUMN check_in_codes_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN check_in_code_roles TEXT[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT church_groups_check_in_code_roles
    CHECK (cardinality(check_in_code_roles) <= 100 AND (NOT check_in_codes_enabled OR cardinality(check_in_code_roles) > 0));

CREATE TABLE check_in_group_member_codes (
  group_id UUID NOT NULL,
  contact_id UUID NOT NULL,
  code_digest TEXT NOT NULL UNIQUE CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  PRIMARY KEY (group_id, contact_id),
  FOREIGN KEY (group_id, contact_id) REFERENCES group_members(group_id, contact_id) ON DELETE CASCADE
);
