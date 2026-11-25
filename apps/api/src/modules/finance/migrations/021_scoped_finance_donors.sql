ALTER TABLE finance_simple_booking_grants
  ADD COLUMN can_view_donors BOOLEAN NOT NULL DEFAULT FALSE,
  DROP CONSTRAINT finance_scoped_access_capabilities,
  ADD CONSTRAINT finance_scoped_access_capabilities CHECK (
    (can_post OR can_view_budget OR can_view_donors) AND (NOT can_view_journal OR can_view_budget)
  );
