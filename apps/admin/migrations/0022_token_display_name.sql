-- Token registry display name (Tokens page Edit modal).
-- The `name` column holds the registry display name only: it changes
-- what the app shows for a token, never the on-chain token. The
-- PATCH /api/admin/tokens/:id endpoint writes it only when this
-- column exists; until this migration is applied, a name edit is
-- refused with a clear error instead of failing.
-- NOT APPLIED YET — apply with:
--   wrangler d1 execute stelix-admin-db --file=migrations/0022_token_display_name.sql
ALTER TABLE tokens ADD COLUMN name TEXT;
