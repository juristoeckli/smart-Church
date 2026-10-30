ALTER TABLE eventdesk_customers ADD COLUMN IF NOT EXISTS directory_contact_id UUID;
ALTER TABLE eventdesk_partners ADD COLUMN IF NOT EXISTS directory_contact_id UUID;
ALTER TABLE eventdesk_freelancers ADD COLUMN IF NOT EXISTS directory_contact_id UUID;

ALTER TABLE eventdesk_customers DROP CONSTRAINT IF EXISTS eventdesk_customers_directory_contact_fk;
ALTER TABLE eventdesk_customers ADD CONSTRAINT eventdesk_customers_directory_contact_fk
  FOREIGN KEY (directory_contact_id, department_id) REFERENCES eventdesk_contacts(id, department_id);
ALTER TABLE eventdesk_partners DROP CONSTRAINT IF EXISTS eventdesk_partners_directory_contact_fk;
ALTER TABLE eventdesk_partners ADD CONSTRAINT eventdesk_partners_directory_contact_fk
  FOREIGN KEY (directory_contact_id, department_id) REFERENCES eventdesk_contacts(id, department_id);
ALTER TABLE eventdesk_freelancers DROP CONSTRAINT IF EXISTS eventdesk_freelancers_directory_contact_fk;
ALTER TABLE eventdesk_freelancers ADD CONSTRAINT eventdesk_freelancers_directory_contact_fk
  FOREIGN KEY (directory_contact_id, department_id) REFERENCES eventdesk_contacts(id, department_id);

UPDATE eventdesk_customers r SET directory_contact_id=c.id FROM eventdesk_contacts c
 WHERE c.department_id=r.department_id AND c.source_type='customer' AND c.source_id=r.id;
UPDATE eventdesk_partners r SET directory_contact_id=c.id FROM eventdesk_contacts c
 WHERE c.department_id=r.department_id AND c.source_type='partner' AND c.source_id=r.id;
UPDATE eventdesk_freelancers r SET directory_contact_id=c.id FROM eventdesk_contacts c
 WHERE c.department_id=r.department_id AND c.source_type='freelancer' AND c.source_id=r.id;

CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_customers_directory_contact_idx ON eventdesk_customers(department_id,directory_contact_id) WHERE directory_contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_partners_directory_contact_idx ON eventdesk_partners(department_id,directory_contact_id,kind) WHERE directory_contact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eventdesk_freelancers_directory_contact_idx ON eventdesk_freelancers(department_id,directory_contact_id) WHERE directory_contact_id IS NOT NULL;
