BEGIN;

-- Older CSV imports created customer rows before the shared contact directory existed.
-- Promote those rows to contact records and make their customer role explicit.
INSERT INTO eventdesk_contacts (id, department_id, kind, name, email, phone, street, postal_code, city, country, notes, roles, active)
SELECT id, department_id, kind, name, email, phone, street, postal_code, city, country, notes, ARRAY['customer'], active
FROM eventdesk_customers
WHERE directory_contact_id IS NULL
ON CONFLICT (id) DO UPDATE SET
  roles = ARRAY(SELECT DISTINCT unnest(eventdesk_contacts.roles || EXCLUDED.roles)),
  updated_at = now();

UPDATE eventdesk_customers
SET directory_contact_id = id
WHERE directory_contact_id IS NULL;

-- Keep customer IDs identical to their contact IDs. Jobs reference the customer
-- projection, so move those references before changing the projection primary key.
ALTER TABLE eventdesk_jobs DROP CONSTRAINT IF EXISTS eventdesk_jobs_customer_id_fkey;

UPDATE eventdesk_jobs jobs
SET customer_id = customers.directory_contact_id
FROM eventdesk_customers customers
WHERE jobs.customer_id = customers.id
  AND customers.directory_contact_id IS NOT NULL
  AND customers.id <> customers.directory_contact_id;

UPDATE eventdesk_customers
SET id = directory_contact_id
WHERE directory_contact_id IS NOT NULL
  AND id <> directory_contact_id;

ALTER TABLE eventdesk_jobs
  ADD CONSTRAINT eventdesk_jobs_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES eventdesk_customers(id) ON DELETE SET NULL;

COMMIT;
