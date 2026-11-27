-- Admin password hash + session version (change password from the admin, 2026-11-27).
-- The password hash lives here once it is changed from the admin; until then the
-- ADMIN_PASSWORD_HASH Pages secret is the fallback. session_version starts at 0
-- (tokens issued before this migration carry no version and count as 0);
-- changing the password bumps it, which invalidates every existing session.
CREATE TABLE IF NOT EXISTS admin_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT,
  session_version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO admin_auth (id, password_hash, session_version) VALUES (1, NULL, 0);
