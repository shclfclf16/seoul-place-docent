PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS bq_v2_review_state (
 id TEXT PRIMARY KEY,
 archive_sha256 TEXT NOT NULL,
 record_id TEXT NOT NULL,
 record_row_sha256 TEXT NOT NULL,
 place_id TEXT NOT NULL DEFAULT '',
 place_row_sha256 TEXT NOT NULL DEFAULT '',
 link_row_sha256 TEXT NOT NULL DEFAULT '',
 link_input_row INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('PENDING','IN_REVIEW','APPROVED','REJECTED','REVOKED','EXPIRED')),
 checks_json TEXT NOT NULL,
 permissions_json TEXT NOT NULL,
 verified_location_json TEXT NOT NULL,
 hold_reason TEXT NOT NULL DEFAULT '',
 reviewer_id TEXT NOT NULL,
 expires_at TEXT,
 revision INTEGER NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(archive_sha256,record_id,record_row_sha256,place_id,place_row_sha256,link_row_sha256,link_input_row)
);
CREATE INDEX IF NOT EXISTS bq_v2_review_by_state ON bq_v2_review_state(state,updated_at);
CREATE TABLE IF NOT EXISTS bq_v2_review_events (
 id TEXT PRIMARY KEY,
 review_state_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('START','SAVE','APPROVE','HOLD','REJECT','REVOKE','EXPIRE','REOPEN','LOGIN_FAILED')),
 snapshot_json TEXT NOT NULL,
 reviewer_id TEXT NOT NULL,
 created_at TEXT NOT NULL ,
 UNIQUE(review_state_id,revision)
);
CREATE INDEX IF NOT EXISTS bq_v2_review_events_state ON bq_v2_review_events(review_state_id,revision);
CREATE TABLE IF NOT EXISTS bq_v2_review_rate_limits(id TEXT PRIMARY KEY,reviewer_id TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS bq_v2_review_rate_window ON bq_v2_review_rate_limits(reviewer_id,created_at);
CREATE TRIGGER IF NOT EXISTS bq_v2_review_events_no_update
BEFORE UPDATE ON bq_v2_review_events BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS bq_v2_review_events_no_delete
BEFORE DELETE ON bq_v2_review_events BEGIN SELECT RAISE(ABORT,'review audit is append-only'); END;
