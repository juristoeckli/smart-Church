CREATE TABLE user_phone_numbers (
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL CHECK (label IN ('home', 'mobile', 'work', 'work_mobile')),
  number TEXT NOT NULL CHECK (length(trim(number)) BETWEEN 1 AND 32),
  PRIMARY KEY (user_id, position)
);
