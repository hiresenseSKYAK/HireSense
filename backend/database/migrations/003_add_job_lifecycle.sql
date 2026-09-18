-- Additive lifecycle metadata for refresh and non-destructive expiration.
ALTER TABLE job_data
    ADD COLUMN first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN last_checked_at DATETIME NULL,
    ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX ix_job_data_active_experience
    ON job_data (active, experience_level);
