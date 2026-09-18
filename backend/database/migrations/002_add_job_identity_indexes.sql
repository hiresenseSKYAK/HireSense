-- Additive phase 2. On a populated database, run only after the identity
-- backfill dry-run reports no collisions and the apply pass succeeds.
CREATE UNIQUE INDEX uq_job_data_identity_key
    ON job_data (identity_key);

CREATE UNIQUE INDEX uq_job_data_source_job
    ON job_data (source, source_job_id);
