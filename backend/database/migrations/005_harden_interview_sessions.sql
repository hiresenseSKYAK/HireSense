-- Additive interview concurrency, cost accounting, and lookup safeguards.
-- Existing sessions remain valid; nullable processing fields are idle by default.
ALTER TABLE interview_sessions
    ADD COLUMN processing_question_index INT NULL AFTER total_questions,
    ADD COLUMN processing_answer_hash CHAR(64) NULL AFTER processing_question_index,
    ADD COLUMN processing_started_at DATETIME NULL AFTER processing_answer_hash,
    ADD COLUMN provider_call_count INT NOT NULL DEFAULT 0 AFTER processing_started_at;

CREATE INDEX ix_interview_sessions_user_created
    ON interview_sessions (user_id, created_at);

CREATE INDEX ix_interview_sessions_user_status
    ON interview_sessions (user_id, status);

CREATE UNIQUE INDEX uq_interview_response_question
    ON interview_responses (session_id, question_id);

CREATE UNIQUE INDEX uq_interview_response_turn
    ON interview_responses (session_id, question_index);

CREATE INDEX ix_interview_responses_session_created
    ON interview_responses (session_id, created_at);
