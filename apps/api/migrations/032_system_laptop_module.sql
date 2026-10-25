-- System Laptop provides shared remote desktop access to the AV control PC.
-- Site administrators control it; location members may watch. Enable it for
-- locations that already use Video until module management is available.
UPDATE departments
   SET enabled_modules = array_append(enabled_modules, 'system-laptop')
 WHERE 'video' = ANY(enabled_modules)
   AND NOT ('system-laptop' = ANY(enabled_modules));
