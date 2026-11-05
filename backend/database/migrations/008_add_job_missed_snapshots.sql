-- Lifecycle: count consecutive complete employer-board (Greenhouse/Lever/Ashby)
-- snapshots a job was missing from. Two misses in a row close the job.
-- Additive only: existing rows start at 0 and nothing is deleted.
ALTER TABLE job_data
    ADD COLUMN missed_snapshots INT NOT NULL DEFAULT 0;

CREATE INDEX ix_job_data_feed_active ON job_data (source_feed_key, active);
