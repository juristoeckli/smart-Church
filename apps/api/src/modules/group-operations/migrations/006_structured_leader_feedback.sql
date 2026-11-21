ALTER TABLE group_meeting_feedback_responses
  ADD COLUMN meeting_comment TEXT NOT NULL DEFAULT '' CHECK (length(meeting_comment) <= 2000),
  ADD COLUMN guest_count INTEGER CHECK (guest_count BETWEEN 0 AND 100000);
