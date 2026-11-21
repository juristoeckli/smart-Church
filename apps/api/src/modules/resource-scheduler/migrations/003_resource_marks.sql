CREATE TABLE resource_scheduler_marks (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES bookable_resources(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id,user_id,resource_id)
);
