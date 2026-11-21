ALTER TABLE community_post_notification_preferences
  ADD COLUMN IF NOT EXISTS digest_weekday SMALLINT CHECK (digest_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS digest_next_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS digest_window_start TIMESTAMPTZ,
  ADD CONSTRAINT community_post_digest_schedule_check CHECK (
    (digest_weekday IS NULL AND digest_next_at IS NULL AND digest_window_start IS NULL)
    OR (digest_weekday IS NOT NULL AND digest_next_at IS NOT NULL AND digest_window_start IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS community_post_digest_due_idx
  ON community_post_notification_preferences(digest_next_at,department_id,user_id) WHERE digest_next_at IS NOT NULL;

CREATE OR REPLACE FUNCTION community_feed_next_digest(weekday SMALLINT, zone TEXT, reference_time TIMESTAMPTZ)
RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE STRICT AS $$
  WITH local_clock AS (SELECT reference_time AT TIME ZONE zone AS wall_clock),
       candidate AS (
         SELECT wall_clock AS local_now,
                wall_clock::date + ((7 + weekday - EXTRACT(ISODOW FROM wall_clock)::int) % 7) + TIME '08:00' AS schedule
         FROM local_clock
       )
  SELECT (CASE WHEN schedule>local_now THEN schedule ELSE schedule + INTERVAL '7 days' END) AT TIME ZONE zone
  FROM candidate;
$$;
