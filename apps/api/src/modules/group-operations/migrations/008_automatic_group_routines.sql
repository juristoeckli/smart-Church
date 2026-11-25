CREATE TABLE group_automatic_routines (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  trigger_role text NOT NULL CHECK (length(trim(trigger_role)) BETWEEN 1 AND 80),
  trigger_status text NOT NULL CHECK (trigger_status IN ('active','paused','waitlist')),
  steps jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 12),
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  authorized_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id,group_id,id)
);
CREATE UNIQUE INDEX group_automatic_routines_trigger_idx
  ON group_automatic_routines(group_id, lower(trim(trigger_role)), trigger_status) WHERE enabled;

CREATE TABLE group_automatic_routine_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  routine_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phase text NOT NULL DEFAULT 'queued' CHECK (phase IN ('queued','waiting','completed','cancelled','failed')),
  next_step integer NOT NULL DEFAULT 0 CHECK (next_step BETWEEN 0 AND 12),
  due_at timestamptz NOT NULL DEFAULT now(),
  chain uuid[] NOT NULL,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (department_id,group_id,routine_id) REFERENCES group_automatic_routines(department_id,group_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX group_automatic_routine_runs_open_idx ON group_automatic_routine_runs(group_id,contact_id)
  WHERE phase IN ('queued','waiting');
CREATE INDEX group_automatic_routine_runs_due_idx ON group_automatic_routine_runs(due_at,id)
  WHERE phase IN ('queued','waiting');
CREATE INDEX group_automatic_routine_runs_history_idx ON group_automatic_routine_runs(department_id,group_id,created_at DESC,id);

CREATE FUNCTION enroll_group_automatic_routine() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prior_chain uuid[] := COALESCE(NULLIF(current_setting('smart_church.automatic_routine_chain',true),'')::uuid[],ARRAY[]::uuid[]);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.group_id=NEW.group_id AND OLD.contact_id=NEW.contact_id
      AND lower(trim(OLD.role)) = lower(trim(NEW.role)) AND OLD.status = NEW.status THEN
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE','DELETE') THEN
    UPDATE group_automatic_routine_runs SET phase='cancelled',outcome='Membership changed.',updated_at=now()
      WHERE group_id=OLD.group_id AND contact_id=OLD.contact_id AND phase IN ('queued','waiting');
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') AND cardinality(prior_chain) < 32 THEN
    INSERT INTO group_automatic_routine_runs(department_id,group_id,routine_id,contact_id,chain)
      SELECT rule.department_id,rule.group_id,rule.id,NEW.contact_id,prior_chain || rule.id
        FROM group_automatic_routines rule
        JOIN church_groups groups ON groups.id=rule.group_id AND groups.department_id=rule.department_id
        JOIN departments department ON department.id=groups.department_id
        JOIN contacts contact ON contact.id=NEW.contact_id AND contact.department_id=rule.department_id
       WHERE rule.group_id=NEW.group_id AND rule.enabled AND lower(trim(rule.trigger_role))=lower(trim(NEW.role)) AND rule.trigger_status=NEW.status
         AND groups.status='active' AND groups.source_system IS NULL AND 'group-operations'=ANY(department.enabled_modules)
         AND NOT rule.id=ANY(prior_chain)
      ON CONFLICT (group_id,contact_id) WHERE phase IN ('queued','waiting') DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER group_member_automatic_routines_after_membership
  AFTER INSERT OR UPDATE OF group_id,contact_id,role,status OR DELETE ON group_members
  FOR EACH ROW EXECUTE FUNCTION enroll_group_automatic_routine();
