-- Stelix 2.0 Admin — migration 0005: chain registry fields for adding
-- chains from the admin (no app rebuild).
-- Apply: wrangler d1 execute stelix-admin-db --remote --file=migrations/0005_add_chain_fields.sql
-- Existing rows are kept intact; new columns are backfilled from the
-- values already stored (status / native_token / stablecoin).
--
-- active: the enable/disable toggle. 1 = listed in the wallet, 0 = hidden
--   from pickers/Discover/Swap until re-enabled. Defaults to 1 so the six
--   seeded chains keep their current visibility (their status column
--   still gates live vs testnet vs hidden).
-- is_testnet: 1 when the chain is a testnet (backfilled from status).
-- native_decimals: decimals of the native gas asset (Arc USDC = 6,
--   Solana SOL = 9, most EVM = 18).
-- stablecoin_decimals: decimals of the exit stablecoin (USDC/USDT = 6).
-- gas_token: symbol of the gas asset; backfilled from native_token.
-- paired_chain_id: slug of the paired chain in a testnet/mainnet pair
--   (e.g. arc-testnet <-> arc), NULL when unpaired. The admin UI fills
--   this in; nothing is paired automatically.

ALTER TABLE chains ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE chains ADD COLUMN is_testnet INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chains ADD COLUMN native_decimals INTEGER NOT NULL DEFAULT 18;
ALTER TABLE chains ADD COLUMN stablecoin_decimals INTEGER NOT NULL DEFAULT 6;
ALTER TABLE chains ADD COLUMN gas_token TEXT;
ALTER TABLE chains ADD COLUMN paired_chain_id TEXT;

UPDATE chains SET is_testnet = 1 WHERE status = 'testnet';
-- Arc row (chain id 5042002) is definitionally Arc TESTNET even though its
-- status was later set to 'live'; Arc mainnet (5042) is a separate row.
UPDATE chains SET is_testnet = 1 WHERE id = 'arc';
UPDATE chains SET native_decimals = 6 WHERE id = 'arc';
UPDATE chains SET native_decimals = 9 WHERE id = 'solana';
UPDATE chains SET stablecoin_decimals = 6 WHERE stablecoin IN ('USDC', 'USDT');
UPDATE chains SET gas_token = native_token WHERE gas_token IS NULL OR gas_token = '';

CREATE INDEX IF NOT EXISTS idx_chains_chain_id ON chains(chain_id);
CREATE INDEX IF NOT EXISTS idx_chains_active ON chains(active);
