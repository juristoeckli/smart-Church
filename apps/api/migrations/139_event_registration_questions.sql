ALTER TABLE service_events
  ADD COLUMN registration_form_revision UUID,
  ADD COLUMN registration_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT service_events_registration_question_array
    CHECK (jsonb_typeof(registration_questions)='array' AND jsonb_array_length(registration_questions)<=8),
  ADD CONSTRAINT service_events_registration_question_revision
    CHECK ((registration_form_revision IS NULL)=(registration_questions='[]'::jsonb));

ALTER TABLE event_registrations ADD COLUMN answer_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(answer_snapshot)='array' AND jsonb_array_length(answer_snapshot)<=8);
