-- Stelix 2.0 Admin — migration 0003: live admin tables (no sample data).
-- Apply: wrangler d1 execute stelix-admin-db --remote --file=migrations/0003_live.sql
-- All tables start EMPTY. The admin shows real empty states until the keeper /
-- mobile app / deploy flow writes real rows. Never seed sample rows here.

-- Locks recorded from on-chain StelixVault events (keeper indexer writes these;
-- the admin only reads them). amount_raw is the raw token amount as text.
CREATE TABLE IF NOT EXISTS locks (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL,
  vault_address TEXT NOT NULL,
  owner TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT '',
  amount_raw TEXT NOT NULL DEFAULT '0',
  amount_decimals INTEGER NOT NULL DEFAULT 18,
  status TEXT NOT NULL DEFAULT 'Active',
  target_price_usd TEXT,
  unlock_time TEXT,
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_locks_owner ON locks(owner);
CREATE INDEX IF NOT EXISTS idx_locks_chain ON locks(chain_id, created_at);

-- Auto-sells executed by the keeper (one row per executed stage / trailing stop).
CREATE TABLE IF NOT EXISTS auto_sells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_id TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT '',
  amount_usd REAL NOT NULL DEFAULT 0,
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_autosells_created ON auto_sells(created_at);

-- Versioned fee / limits config. The latest row is the live config.
CREATE TABLE IF NOT EXISTS fee_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  published_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Keeper pause state (single row, id = 1) + optional keeper wallet address.
CREATE TABLE IF NOT EXISTS keeper_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0,
  keeper_address TEXT,
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO keeper_state (id, paused) VALUES (1, 0);

-- Compile jobs: one row per Contract Studio compile of StelixVault source.
CREATE TABLE IF NOT EXISTS compile_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  bytecode_hash TEXT,
  deployed_bytes INTEGER,
  within_size_limit INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ok',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Automated audit runs (built-in static checker; NOT a substitute for an
-- independent human audit). findings_json is the full AuditResult findings array.
CREATE TABLE IF NOT EXISTS audit_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT NOT NULL,
  compiler TEXT NOT NULL,
  verdict TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Independent (human) audits recorded by the owner. A row here never claims
-- an audit exists unless a real report (auditor, date, scope, verdict and a
-- report link/reference) was actually received.
CREATE TABLE IF NOT EXISTS external_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auditor TEXT NOT NULL,
  audit_date TEXT NOT NULL,
  scope TEXT NOT NULL,
  verdict TEXT NOT NULL,
  report_url TEXT,
  report_ref TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contract Studio deploy preparations (exact command + args to run via the
-- testnet deployer flow) and registrations are recorded in `deployments`
-- (migration 0001) by POST /api/admin/deploy/register.

-- Mainnet-gate attestations (kind = 'smoke' for a recorded small-value
-- mainnet smoke-test attestation). The Worker enforces the full gate.
CREATE TABLE IF NOT EXISTS gate_attestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  attested_by TEXT NOT NULL DEFAULT '',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
