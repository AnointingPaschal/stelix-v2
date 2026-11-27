-- Stelix 2.0 Admin — migration 0017: launchpad logo uploads + token registry logos.
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0017_launch_logos.sql
--
-- R2 is NOT enabled on this Cloudflare account (API code 10042), so logo
-- files are stored as base64 in D1 and served back by the Worker at
-- GET /api/logo/:key. The upload endpoint caps files at 256 KB, so a
-- stored logo is at most ~342 KB of base64 — small enough for D1 and for
-- the on-chain logoURI, which stores only the short https URL of the
-- serve route, never the image bytes (storing image bytes on-chain
-- would cost far more gas than any block allows). If R2 is ever enabled,
-- the serve route is the one place to swap the backing store; the URL
-- shape and the on-chain logoURI stay the same.
-- tokens.logo_url: the Token/DEX registry row for a launched token
-- carries its logo, so the wallet (which syncs tokens via /api/sync)
-- shows the logo wherever the token is imported, with no extra fetch.
CREATE TABLE IF NOT EXISTS launch_logos (
  key TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE tokens ADD COLUMN logo_url TEXT;
