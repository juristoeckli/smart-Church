CREATE TABLE IF NOT EXISTS eventdesk_document_settings (
  department_id UUID PRIMARY KEY REFERENCES departments(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL DEFAULT '' CHECK (char_length(business_name) <= 160),
  street TEXT NOT NULL DEFAULT '' CHECK (char_length(street) <= 200),
  postal_code TEXT NOT NULL DEFAULT '' CHECK (char_length(postal_code) <= 24),
  city TEXT NOT NULL DEFAULT '' CHECK (char_length(city) <= 120),
  country TEXT NOT NULL DEFAULT '' CHECK (char_length(country) <= 80),
  email TEXT NOT NULL DEFAULT '' CHECK (char_length(email) <= 254),
  phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  tax_identifier TEXT NOT NULL DEFAULT '' CHECK (char_length(tax_identifier) <= 80),
  payment_terms TEXT NOT NULL DEFAULT '' CHECK (char_length(payment_terms) <= 1000),
  footer TEXT NOT NULL DEFAULT '' CHECK (char_length(footer) <= 1000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
