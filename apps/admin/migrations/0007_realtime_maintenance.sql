-- Stelix 2.0 Admin — migration 0007: realtime sync version, chain tombstones, maintenance mode.
-- Apply: wrangler d1 execute stelix-admin-db --remote --file=migrations/0007_realtime_maintenance.sql
-- (Local: wrangler d1 execute stelix-admin-db --local --file=migrations/0007_realtime_maintenance.sql)
--
-- sync_state: single-row monotonic version, bumped by the Worker on EVERY
-- admin write (chains, fees, announcements, config, tokens, maintenance,
-- deploy registration). The wallet polls GET /api/sync and only re-applies
-- state when the version changes, so an admin edit is visible within one
-- poll interval (~45s) instead of after a 5-minute cache or a restart.
--
-- deleted_chains: tombstones. Deleting a chain removes its row from `chains`
-- but records the slug here forever, so the wallet can never resurrect it
-- from its built-in fallback registry (and a later re-add of the same slug
-- deletes the tombstone via the create path).
--
-- maintenance: single-row maintenance mode. When enabled the wallet shows
-- the admin's message and blocks signing; scope 'all' shows a full
-- maintenance screen, scope 'wallet' shows a banner and blocks on-chain
-- actions while still allowing browsing. The admin portal itself is never
-- blocked by this flag, so maintenance can always be switched off.

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO sync_state (id, version) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS deleted_chains (
  id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'wallet',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO maintenance (id, enabled, message, scope) VALUES (1, 0, '', 'wallet');
