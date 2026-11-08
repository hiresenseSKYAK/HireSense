-- Keeps each signed-in user's latest resume analysis (parsed details and score, as JSON),
-- so it is still available after logging out and back in. The original file is never stored.
CREATE TABLE IF NOT EXISTS user_resumes (
    user_id INT NOT NULL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    analysis_json MEDIUMTEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_resumes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
