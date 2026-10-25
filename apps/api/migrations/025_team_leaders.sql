CREATE TABLE IF NOT EXISTS church_team_leaders (
  team_id UUID NOT NULL REFERENCES church_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS church_team_leaders_user_idx ON church_team_leaders (user_id, team_id);
