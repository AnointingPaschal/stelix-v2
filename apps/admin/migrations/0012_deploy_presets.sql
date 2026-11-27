-- Stelix 2.0 Admin — migration 0012: deploy presets for Contract Studio.
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0012_deploy_presets.sql
--
-- User request 2026-11-27 09:52 WAT: "create a page where i will input
-- this and save to pull in the contract studio so i won't have to be
-- filling it everytime".
--
-- One preset per (chain_id, env): the 7 StelixVault constructor values
-- (owner, keeper, router, priceFeed, penaltyRecipient, feeRecipient,
-- autoSellFeeBps). Fields may be blank in a preset — a preset is a draft
-- until the router / price-feed adapter addresses exist — but any
-- non-blank address must be a valid 0x address (enforced server-side).
-- Contract Studio loads the preset for the selected network and fills
-- the form from it; switching networks still clears the form first, then
-- fills from the matching preset, so testnet values are never carried
-- to mainnet.
--
-- IMPORTANT — router / price feed: there is NO deployed adapter address
-- to seed here. The vault speaks V2-style IDexRouter, Arc has only a
-- Uniswap V3 SwapRouter (testnet 0xfA845604F52843a7b5cfA4030120c6238741F420,
-- mainnet 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77), so the router must
-- be the StelixV3RouterAdapter address and the price feed the
-- UniswapV3TwapFeed address, both deployed first. Seeding the V3 router
-- address directly would make deploys revert, so router / price_feed
-- are seeded EMPTY on purpose.
--
-- Seed: Arc Testnet preset with the user's single-owner address
-- 0xCca907AE079DB7638A4d2D3e82defaea5FBDF383 (decided 2026-11-27 09:47
-- WAT: single owner for testnet testing, multisig later via
-- transferOwnership). Keeper is left blank — it must be a different
-- wallet, his second wallet ending 7b0B2B — and router / price_feed
-- are blank until the adapters are deployed.

CREATE TABLE IF NOT EXISTS deploy_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_id TEXT NOT NULL,
  env TEXT NOT NULL CHECK (env IN ('testnet', 'mainnet')),
  label TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  keeper TEXT NOT NULL DEFAULT '',
  router TEXT NOT NULL DEFAULT '',
  price_feed TEXT NOT NULL DEFAULT '',
  penalty_recipient TEXT NOT NULL DEFAULT '',
  fee_recipient TEXT NOT NULL DEFAULT '',
  auto_sell_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (auto_sell_fee_bps BETWEEN 0 AND 1000),
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chain_id, env)
);

INSERT OR IGNORE INTO deploy_presets
  (chain_id, env, label, owner, keeper, router, price_feed, penalty_recipient, fee_recipient, auto_sell_fee_bps, updated_by)
VALUES
  ('arc', 'testnet', 'Arc Testnet — single owner test',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   0, 'seed-2026-11-27');
