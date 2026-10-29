UPDATE departments
   SET enabled_modules = array_remove(enabled_modules, 'eventdesk')
 WHERE 'eventdesk' = ANY(enabled_modules);
