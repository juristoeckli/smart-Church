ALTER TABLE group_meeting_feedback_templates
  ADD COLUMN IF NOT EXISTS anonymous_attendee_responses BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE group_meeting_feedback_attendee_submissions
  ALTER COLUMN contact_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS anonymous_response_token_hash TEXT;

ALTER TABLE group_meeting_feedback_attendee_submissions
  ADD CONSTRAINT group_meeting_feedback_attendee_identity_check
  CHECK ((contact_id IS NULL) = (anonymous_response_token_hash IS NOT NULL));

CREATE UNIQUE INDEX IF NOT EXISTS group_meeting_feedback_anonymous_token_idx
  ON group_meeting_feedback_attendee_submissions(meeting_id,anonymous_response_token_hash)
  WHERE anonymous_response_token_hash IS NOT NULL;
