ALTER TABLE app_users DROP CONSTRAINT app_users_role_check;

UPDATE app_users
   SET role = 'server_admin'
 WHERE role = 'admin';

ALTER TABLE app_users
  ADD CONSTRAINT app_users_role_check CHECK (role IN ('server_admin'));
