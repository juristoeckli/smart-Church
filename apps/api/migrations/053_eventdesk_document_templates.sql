ALTER TABLE eventdesk_document_settings
  ADD COLUMN IF NOT EXISTS logo_jpeg BYTEA,
  ADD COLUMN IF NOT EXISTS document_templates JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tax_profiles JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE eventdesk_documents
  ADD COLUMN IF NOT EXISTS branding_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS logo_snapshot BYTEA;

UPDATE eventdesk_documents d
   SET branding_snapshot=jsonb_build_object(
         'businessName',coalesce(s.business_name,''),'street',coalesce(s.street,''),'postalCode',coalesce(s.postal_code,''),
         'city',coalesce(s.city,''),'country',coalesce(s.country,''),'email',coalesce(s.email,''),'phone',coalesce(s.phone,''),
         'taxIdentifier',coalesce(s.tax_identifier,''),'paymentTerms',coalesce(s.payment_terms,''),'footer',coalesce(s.footer,''),
         'template',coalesce(s.document_templates->d.kind,'{}'::jsonb),'taxProfileName','','legalText',''),
       logo_snapshot=s.logo_jpeg
  FROM eventdesk_document_settings s
 WHERE s.department_id=d.department_id AND d.branding_snapshot IS NULL;

UPDATE eventdesk_documents
   SET branding_snapshot=jsonb_build_object('businessName','','street','','postalCode','','city','','country','','email','','phone','','taxIdentifier','','paymentTerms','','footer','','template','{}'::jsonb,'taxProfileName','','legalText','')
 WHERE branding_snapshot IS NULL;
