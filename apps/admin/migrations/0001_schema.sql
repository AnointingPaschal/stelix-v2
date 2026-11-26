-- Stelix 2.0 Admin — D1 schema (Cloudflare). Apply: wrangler d1 execute stelix-admin-db --file=migrations/0001_schema.sql
CREATE TABLE IF NOT EXISTS chains (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, chain_id INTEGER NOT NULL,
  rpc_urls TEXT NOT NULL, explorer_url TEXT NOT NULL, native_token TEXT NOT NULL,
  stablecoin TEXT NOT NULL, stablecoin_address TEXT NOT NULL, dex_router TEXT NOT NULL,
  vault_address TEXT, status TEXT NOT NULL DEFAULT 'hidden', is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, chain_id TEXT NOT NULL,
  address TEXT NOT NULL, decimals INTEGER NOT NULL DEFAULT 18,
  verified INTEGER NOT NULL DEFAULT 0, featured INTEGER NOT NULL DEFAULT 0,
  UNIQUE(chain_id, address)
);
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chain_id TEXT NOT NULL, address TEXT NOT NULL,
  tx_hash TEXT, compiler_version TEXT NOT NULL, bytecode_hash TEXT, artifact_hash TEXT,
  parameters_json TEXT, verification_status TEXT NOT NULL DEFAULT 'pending',
  env TEXT NOT NULL DEFAULT 'testnet', github_commit TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS keeper_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, chain_id TEXT NOT NULL,
  locks_checked INTEGER NOT NULL DEFAULT 0, triggers INTEGER NOT NULL DEFAULT 0,
  executed INTEGER NOT NULL DEFAULT 0, retried INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok', detail_json TEXT
);
CREATE TABLE IF NOT EXISTS config_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, payload_json TEXT NOT NULL,
  signature TEXT, published_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, message TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all', expires_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT NOT NULL, action TEXT NOT NULL,
  detail TEXT, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_keeper_chain ON keeper_runs(chain_id, started_at);
