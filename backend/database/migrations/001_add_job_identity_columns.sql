-- Additive phase 1. Run once before identity backfill or crawler execution.
-- Safe for the empty production database and the populated legacy database.
ALTER TABLE job_data
    ADD COLUMN source VARCHAR(32) NULL AFTER id,
    ADD COLUMN source_job_id VARCHAR(191) NULL AFTER source,
    ADD COLUMN canonical_url VARCHAR(1000) NULL AFTER application_link,
    ADD COLUMN identity_key CHAR(64) NULL AFTER canonical_url;
