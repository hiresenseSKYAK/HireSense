-- Widen only location; it is not indexed. Preserve all rows and job IDs.
ALTER TABLE job_data MODIFY COLUMN location VARCHAR(512) NULL;
