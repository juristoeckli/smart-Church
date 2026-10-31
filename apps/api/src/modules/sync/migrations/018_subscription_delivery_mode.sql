-- Older installations created subscriptions before delivery mode was added.
-- Legacy subscriptions used recipient-initiated pull sync.
ALTER TABLE sync_subscriptions
  ADD COLUMN IF NOT EXISTS delivery_mode TEXT NOT NULL DEFAULT 'pull'
    CHECK (delivery_mode IN ('pull','push'));
