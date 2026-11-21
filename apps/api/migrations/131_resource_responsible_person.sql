ALTER TABLE bookable_resources ADD COLUMN responsible_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL;
