-- Nullable, source-backed company branding. Existing rows remain valid.
ALTER TABLE job_data
    ADD COLUMN company_logo_url VARCHAR(1000) NULL AFTER company;
