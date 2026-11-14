-- One AI-written summary per job, shared by every user who opens the job.
-- source_hash is the SHA-256 of the summarized description; a changed description is summarized again.
CREATE TABLE IF NOT EXISTS job_ai_summaries (
    job_id INT NOT NULL PRIMARY KEY,
    source_hash CHAR(64) NOT NULL,
    model VARCHAR(100) NOT NULL,
    summary_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_job_ai_summaries_job FOREIGN KEY (job_id) REFERENCES job_data (id) ON DELETE CASCADE
);
