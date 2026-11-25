ALTER TABLE group_meeting_places
  ADD COLUMN IF NOT EXISTS public_approval_hash TEXT
    CHECK (public_approval_hash IS NULL OR public_approval_hash ~ '^[a-f0-9]{64}$');
