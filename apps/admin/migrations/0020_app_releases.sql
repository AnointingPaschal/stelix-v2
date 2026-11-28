-- Stelix 2.0 Admin — migration 0020: app releases.
-- app_releases: a published app version the wallet shows as an update
-- prompt. The latest row is served in /api/sync as `appUpdate` (null
-- until the first release is published). force = 1 means users cannot
-- dismiss the prompt; otherwise the wallet shows it at most once per
-- 24h per device. The URL is the download link (e.g. the EAS build /
-- store link) — the wallet opens it, it never downloads in-app.
CREATE TABLE app_releases (
  id INTEGER PRIMARY KEY,
  version TEXT NOT NULL,
  notes TEXT,
  url TEXT,
  force INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
