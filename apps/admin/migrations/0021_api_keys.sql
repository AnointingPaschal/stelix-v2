-- Stelix 2.0 Admin — migration 0021: admin-managed API keys.
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0021_api_keys.sql
--
-- api_keys: named secrets the Worker uses server-side (e.g. the Circle
-- API key, explorer keys). Values are AES-GCM encrypted with a key
-- derived from CONFIG_SIGNING_SECRET (see src/lib/apiKeys.ts) — the
-- stored `value` is `v1.<iv>.<ciphertext>`, never plaintext. The admin
-- UI and every API response carry only `name` + `hint` (first 4 + last
-- 4 characters of the value); the full value is never returned after
-- saving and never appears in /api/sync or any app-facing response.
-- A stored key named `circle` takes precedence over the CIRCLE_API_KEY
-- Pages secret for the Worker's Circle calls; when no stored key
-- exists the Pages secret is used as before.
-- Rotating CONFIG_SIGNING_SECRET makes stored keys undecryptable —
-- they then read as missing (Circle falls back to the Pages secret)
-- until they are re-saved. No seed phrase is ever stored here.
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  hint TEXT NOT NULL DEFAULT '',
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
