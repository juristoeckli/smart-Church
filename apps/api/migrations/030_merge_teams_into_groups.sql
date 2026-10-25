INSERT INTO church_groups (id, department_id, name, description)
SELECT gen_random_uuid(), t.department_id, t.name, t.description
  FROM church_teams t
 WHERE NOT EXISTS (
   SELECT 1 FROM church_groups g
    WHERE g.department_id=t.department_id AND lower(g.name)=lower(t.name)
 );

INSERT INTO group_members (group_id, contact_id)
SELECT g.id, tm.contact_id
  FROM team_members tm
  JOIN church_teams t ON t.id=tm.team_id
  JOIN church_groups g ON g.department_id=t.department_id AND lower(g.name)=lower(t.name)
ON CONFLICT (group_id, contact_id) DO NOTHING;
