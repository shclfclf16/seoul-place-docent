-- Separate private Preview registry. Apply only after operator approval.
CREATE TABLE IF NOT EXISTS bq_v2_review_sessions (
 id TEXT PRIMARY KEY,
 reviewer_id TEXT NOT NULL,
 credential_digest TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bq_v2_sessions_expiry ON bq_v2_review_sessions(expires_at);
