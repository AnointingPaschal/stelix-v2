-- 0016_admin_settings.sql — small key/value store for admin-only switches.
-- The only setting today is 'mainnet_gate_bypass': '1' makes the mainnet
-- gate optional (the admin's explicit choice, 2026-11-27), '0' or absent
-- means the gate is enforced. The Worker reads it on every mainnet
-- prepare / register, so flipping it takes effect immediately.
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
