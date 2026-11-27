-- Stelix 2.0 Admin — migration 0009: multisig creator (Safe protocol).
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0009_multisigs.sql
--
-- A multisig is prepared in the admin, created by the owners in their own
-- wallet (Safe web app / Safe CLI / `cast safe create` — the admin never
-- deploys it and never holds a private key), and only recorded as
-- `deployed` after the Worker verifies it on-chain (contract code present
-- + getThreshold() + getOwners() match the prepared set). Only a deployed
-- Safe can be picked as the StelixVault Owner in Contract Studio.
-- status is 'prepared' or 'deployed'. safe_address is NULL until the
-- Safe is actually deployed and verified — a predicted address lives in
-- predicted_address and is never usable as Owner. The UNIQUE(chain_id,
-- safe_address) allows many NULL safe_address values (SQLite treats NULLs
-- as distinct) while preventing the same deployed Safe being recorded twice
-- on one chain.
CREATE TABLE IF NOT EXISTS multisigs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id TEXT NOT NULL,
  label TEXT,
  owners_json TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  salt_nonce TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'prepared',
  predicted_address TEXT,
  safe_address TEXT,
  deploy_tx_hash TEXT,
  factory_address TEXT NOT NULL,
  singleton_address TEXT NOT NULL,
  safe_version TEXT NOT NULL DEFAULT '1.4.1',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deployed_at TEXT,
  UNIQUE(chain_id, safe_address)
);
CREATE INDEX IF NOT EXISTS idx_multisigs_chain ON multisigs(chain_id, status);
