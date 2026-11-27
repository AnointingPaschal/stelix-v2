-- Stelix 2.0 Admin — migration 0010: Circle User-Controlled Wallets (Arc only, EOA first).
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0010_circle.sql
-- (Local: wrangler d1 execute stelix-admin-db --local --file=migrations/0010_circle.sql)
--
-- circle_users maps a Stelix user id (the external userId the app passes
-- in) to the Circle user id returned by POST /v1/w3s/users. The Circle id
-- is what GET /v1/w3s/wallets?userId= takes; the external id is what
-- POST /v1/w3s/users/token takes to mint a user session token.
--
-- circle_config holds the CIRCLE_APP_ID (a PUBLIC App ID from the Circle
-- Console — it is not a secret and is labelled as such; the API key stays
-- a Wrangler secret CIRCLE_API_KEY and is never stored in D1 or in git).
--
-- circle_challenges is the audit trail of challenges this backend
-- created. The backend never holds a user key share and never signs:
-- the mobile SDK executes the challengeId and the user approves with
-- their PIN. The userToken/encryptionKey minted for a challenge are
-- used once in memory and never stored or returned.
CREATE TABLE IF NOT EXISTS circle_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  circle_user_id TEXT NOT NULL,
  email TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS circle_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_id TEXT,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS circle_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge_id TEXT NOT NULL UNIQUE,
  circle_user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  blockchain TEXT NOT NULL,
  wallet_id TEXT,
  contract_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_circle_challenges_user ON circle_challenges(circle_user_id, created_at);

-- Seed the Circle App ID supplied by the user on 2026-11-27. It is a
-- PUBLIC identifier, not a secret — the API key is never stored here
-- (it stays a Wrangler secret CIRCLE_API_KEY). Fresh D1 databases get
-- the App ID on first apply; existing databases keep whatever the
-- admin already saved (ON CONFLICT DO NOTHING). NOTE: as of
-- 2026-11-27 the API key still returns HTTP 403 on GET
-- /v1/w3s/config/entity, so this App ID has NOT yet been confirmed
-- against the appId Circle reports — GET /api/circle/config confirms
-- the match once the key is accepted.
INSERT INTO circle_config (id, app_id, updated_by)
VALUES (1, 'd15deb9f-8d3c-5c06-be01-de05897d30ea', 'seed-2026-11-27')
ON CONFLICT(id) DO NOTHING;
