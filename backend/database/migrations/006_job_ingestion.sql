-- Additive ingestion metadata. Existing IDs, links and first-seen values remain intact.
ALTER TABLE job_data
    ADD COLUMN source_url VARCHAR(1000) NULL,
    ADD COLUMN source_feed_key VARCHAR(64) NULL,
    ADD COLUMN source_updated_at DATETIME NULL,
    ADD COLUMN last_verified_at DATETIME NULL,
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';

UPDATE job_data SET status = 'closed' WHERE active = FALSE;

CREATE INDEX ix_job_data_status_first_seen ON job_data (status, first_seen_at);
CREATE INDEX ix_job_data_active_posted ON job_data (active, date_posted);
CREATE INDEX ix_job_data_active_seen ON job_data (active, first_seen_at);
CREATE INDEX ix_job_data_company_title ON job_data (company(100), job_title(100));
CREATE INDEX ix_job_data_title ON job_data (job_title(191));
CREATE INDEX ix_job_data_last_seen ON job_data (last_seen_at);
CREATE INDEX ix_job_data_feed_seen ON job_data (source_feed_key, last_seen_at);
CREATE INDEX ix_job_data_canonical_url ON job_data (canonical_url(191));

CREATE TABLE IF NOT EXISTS job_source_health (
    source_key VARCHAR(191) PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    company VARCHAR(255) NULL,
    board_identifier VARCHAR(191) NULL,
    last_success DATETIME NULL,
    last_failure DATETIME NULL,
    failure_count INT NOT NULL DEFAULT 0,
    jobs_received INT NOT NULL DEFAULT 0,
    complete_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
    duration_ms INT NULL,
    rate_limited_until DATETIME NULL,
    last_error_code VARCHAR(64) NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX ix_job_source_health_provider (provider)
);

CREATE TABLE IF NOT EXISTS job_source_alias (
    provider VARCHAR(32) NOT NULL,
    source_job_id VARCHAR(191) NOT NULL,
    job_id INT NOT NULL,
    first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, source_job_id),
    INDEX ix_job_source_alias_job (job_id)
);
