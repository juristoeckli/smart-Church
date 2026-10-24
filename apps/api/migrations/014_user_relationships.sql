CREATE TABLE user_relationships (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  related_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('spouse', 'parent', 'child', 'sibling', 'guardian', 'ward', 'other')),
  PRIMARY KEY (user_id, related_user_id),
  CHECK (user_id <> related_user_id)
);

CREATE INDEX user_relationships_related_user_id_idx ON user_relationships (related_user_id);
