-- Stelix 2.0 Admin — migration 0018: token registry order + cyber defense.
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0018_token_order_cyber.sql
--
-- tokens.sort_order: the admin Token Registry controls the order tokens
-- appear in the app's My Assets for a chain (lower = first). The wallet
-- syncs tokens ordered by (chain_id, sort_order, symbol); registry
-- tokens sort before user-imported tokens, which keep their saved order.
-- Existing rows all get 0 and keep their old symbol order.
--
-- security_events: the real-time attack feed for the Cyber Defense page.
-- Every security-relevant request is recorded here: failed admin
-- sign-ins, blocked-IP hits, unauthorized admin attempts, manual
-- blocks/unblocks, and successful admin sign-ins (so a sign-in from a
-- new IP is visible). Rows are pruned to the latest 5000 by the Worker.
-- status: 'blocked' (refused at the Worker) | 'intercepted' (stopped by
-- a guard: lockout, unauthorized) | 'failed' (bad credentials) |
-- 'success' (a sign-in that went through — watch these).
--
-- security_blocks: the blocklist the "gunner" fires from. An IP here is
-- refused with 403 on EVERY Worker route (admin + public API + sync).
-- expires_at NULL = permanent until an admin unblocks it. A Worker-level
-- block does NOT stop anyone calling the vault contracts directly
-- on-chain — the contracts' own onlyOwner / onlyKeeper guards are the
-- defense there; the blocklist protects the admin and the APIs.
CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT '',
  path TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_ip ON security_events (ip);

CREATE TABLE IF NOT EXISTS security_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL DEFAULT '',
  blocked_by TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_security_blocks_active ON security_blocks (active);

ALTER TABLE tokens ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
