-- EventDesk is opt-in. Remove the automatic enablement from migration 037
-- for installations where that migration has already run.
UPDATE departments
   SET enabled_modules = array_remove(enabled_modules, 'eventdesk')
 WHERE 'eventdesk' = ANY(enabled_modules);
