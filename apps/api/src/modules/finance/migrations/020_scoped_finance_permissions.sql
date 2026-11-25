ALTER TABLE finance_simple_booking_grants
  ADD COLUMN can_post BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN can_view_budget BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN can_view_journal BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT finance_scoped_access_capabilities CHECK (
    (can_post OR can_view_budget) AND (NOT can_view_journal OR can_view_budget)
  );
