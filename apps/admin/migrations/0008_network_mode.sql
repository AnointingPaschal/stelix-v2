-- Stelix 2.0 Admin — migration 0008: admin-controlled testnet/mainnet mode.
-- Apply: wrangler d1 execute stelix-admin-db --remote --file=migrations/0008_network_mode.sql
-- (Local: wrangler d1 execute stelix-admin-db --local --file=migrations/0008_network_mode.sql)
--
-- network_mode: single-row global mode, set ONLY from the admin (Chain
-- Manager page). mode is NULL when the admin has never chosen: the wallet
-- then shows all networks, exactly as before (Arc testnet default).
-- mode = 'testnet': the wallet shows testnet chains only.
-- mode = 'mainnet': the wallet shows mainnet chains only.
--
-- Safety guard (unchanged by this switch): flipping the mode does NOT
-- deploy a vault, does NOT bypass the mainnet gate, and does NOT make
-- locks/swaps go live on mainnet. On a mainnet chain with no vault
-- deployed, the wallet still refuses locks/swaps honestly ("Vault not
-- deployed on Mainnet yet"). The per-chain testnet flag in Chain Manager
-- still applies on top: a chain is shown only when it matches the mode
-- AND is enabled.
--
-- The mode is served in GET /api/sync alongside the sync version, so it
-- propagates to the wallet within one poll interval (~45s) like every
-- other admin change, with an audit_log entry on every change.

CREATE TABLE IF NOT EXISTS network_mode (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO network_mode (id, mode) VALUES (1, NULL);
