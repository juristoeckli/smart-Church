ALTER TABLE church_groups
  ADD COLUMN IF NOT EXISTS parent_group_id UUID REFERENCES church_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS church_groups_parent_idx ON church_groups(department_id,parent_group_id,name);

ALTER TABLE group_members
  ADD COLUMN IF NOT EXISTS auto_managed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS group_membership_custom_fields (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object'),
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(group_id,contact_id)
);

CREATE TABLE IF NOT EXISTS group_membership_rules (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_status TEXT NOT NULL CHECK (contact_status IN ('member','visitor')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id,contact_status)
);

CREATE TABLE IF NOT EXISTS group_hierarchy_invitations (
  id UUID PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES church_groups(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS group_hierarchy_invitations_group_idx ON group_hierarchy_invitations(department_id,group_id,created_at DESC);

CREATE TABLE IF NOT EXISTS group_hierarchy_history (
  id UUID PRIMARY KEY,
  department_id UUID,
  group_id UUID NOT NULL,
  actor_user_id UUID,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('group','membership')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','updated','deleted')),
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS group_hierarchy_history_group_idx ON group_hierarchy_history(department_id,group_id,created_at DESC);

CREATE OR REPLACE FUNCTION smart_church_record_group_change() RETURNS trigger AS $$
DECLARE
  group_id_value UUID;
  department_id_value UUID;
  entity_id_value UUID;
  before_value JSONB;
  after_value JSONB;
  action_value TEXT;
BEGIN
  action_value := CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END;
  IF TG_TABLE_NAME='church_groups' THEN
    IF TG_OP='DELETE' THEN
      group_id_value := OLD.id;
      department_id_value := OLD.department_id;
      entity_id_value := OLD.id;
      before_value := to_jsonb(OLD);
    ELSE
      group_id_value := NEW.id;
      department_id_value := NEW.department_id;
      entity_id_value := NEW.id;
      after_value := to_jsonb(NEW);
      IF TG_OP='UPDATE' THEN before_value := to_jsonb(OLD); END IF;
    END IF;
    INSERT INTO group_hierarchy_history(id,department_id,group_id,actor_user_id,entity_kind,entity_id,action,before_data,after_data)
    VALUES(gen_random_uuid(),department_id_value,group_id_value,NULLIF(current_setting('smart_church.actor_id',true),'')::uuid,'group',entity_id_value,action_value,before_value,after_value);
  ELSE
    IF TG_OP='DELETE' THEN
      group_id_value := OLD.group_id;
      entity_id_value := OLD.contact_id;
      before_value := to_jsonb(OLD);
    ELSE
      group_id_value := NEW.group_id;
      entity_id_value := NEW.contact_id;
      after_value := to_jsonb(NEW);
      IF TG_OP='UPDATE' THEN before_value := to_jsonb(OLD); END IF;
    END IF;
    SELECT department_id INTO department_id_value FROM church_groups WHERE id=group_id_value;
    INSERT INTO group_hierarchy_history(id,department_id,group_id,actor_user_id,entity_kind,entity_id,action,before_data,after_data)
    VALUES(gen_random_uuid(),department_id_value,group_id_value,NULLIF(current_setting('smart_church.actor_id',true),'')::uuid,'membership',entity_id_value,action_value,before_value,after_value);
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS smart_church_group_history ON church_groups;
CREATE TRIGGER smart_church_group_history AFTER INSERT OR UPDATE OR DELETE ON church_groups FOR EACH ROW EXECUTE FUNCTION smart_church_record_group_change();
DROP TRIGGER IF EXISTS smart_church_group_member_history ON group_members;
CREATE TRIGGER smart_church_group_member_history AFTER INSERT OR UPDATE OR DELETE ON group_members FOR EACH ROW EXECUTE FUNCTION smart_church_record_group_change();

CREATE OR REPLACE FUNCTION smart_church_apply_group_membership_rules() RETURNS trigger AS $$
BEGIN
  DELETE FROM group_members member USING group_membership_rules rule
   WHERE member.contact_id=NEW.id AND member.group_id=rule.group_id AND member.auto_managed=TRUE
     AND rule.department_id=NEW.department_id AND (rule.enabled=FALSE OR rule.contact_status<>NEW.status);

  INSERT INTO group_members(group_id,contact_id,role,status,joined_on,auto_managed)
  SELECT rule.group_id,NEW.id,'Member','active',CURRENT_DATE,TRUE
    FROM group_membership_rules rule
   WHERE rule.department_id=NEW.department_id AND rule.enabled=TRUE AND rule.contact_status=NEW.status
  ON CONFLICT(group_id,contact_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS smart_church_contact_group_rules ON contacts;
CREATE TRIGGER smart_church_contact_group_rules AFTER INSERT OR UPDATE OF status ON contacts FOR EACH ROW EXECUTE FUNCTION smart_church_apply_group_membership_rules();
