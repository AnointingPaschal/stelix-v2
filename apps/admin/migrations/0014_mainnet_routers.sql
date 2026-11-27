-- Stelix 2.0 Admin — migration 0014: mainnet routers + Base USDC fix.
-- Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0014_mainnet_routers.sql
--
-- User request 2026-11-27 14:28 WAT: "make sure the chains mainnet
-- foundry for router and price feed are working and also the vault
-- deployment is also working.. Just as you did for testnet, do so for
-- mainnet also.."
--
-- Two corrections first. (1) Migration 0013 wrote the WRONG Base
-- mainnet USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029). The real
-- Circle native USDC on Base is
-- 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 dec, Basescan
-- FiatTokenProxy + Circle docs, verified 2026-11-27). The wrong value
-- shares its first 32 hex chars with the real address and differs only
-- at the end — it is not a real contract. The mobile app had the same
-- wrong value (chains.ts, swapTokens.ts) and is fixed in the same
-- commit. (2) The mainnet dex_router values for ethereum, base and
-- polygon were blank in D1; they are now the verified routers:
--   Ethereum mainnet V2 Router02
--     0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D (official Uniswap V2
--     deployments page; mainnet only, never Sepolia).
--   Base mainnet V3 SwapRouter02
--     0x2626664c2603336E57B271c5C0b26F421741e481 (official Uniswap V3
--     Base deployments page). The candidate
--     0x2626664c2603336E57B271c5C0b26F21AB9933d8 is NOT a real contract.
--   Polygon mainnet V3 SwapRouter02
--     0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45 (official Uniswap V3
--     Polygon deployments page). 0xE592427A… is the v1 SwapRouter, not
--     SwapRouter02, and the adapter targets SwapRouter02.
-- Arc mainnet (0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77) and BNB
-- mainnet (0x10ED43C718714eb63d5aA57B78B54704E256024E) were already
-- correct in D1 and are left untouched.
--
-- Seeds: one mainnet deploy preset per EVM chain (owner / penalty /
-- fee = the user's single-owner test address; keeper, router and
-- price_feed stay blank until the adapters are deployed from the
-- admin and the keeper wallet is chosen — on mainnet the keeper MUST
-- be a different wallet from the owner, enforced by DeployVault).
-- BNB mainnet exit stablecoin is Binance-Peg USDT (18 decimals);
-- the V2 feed constructor takes 18 for it.

UPDATE chains SET stablecoin_address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' WHERE id = 'base';
UPDATE chains SET dex_router = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' WHERE id = 'ethereum';
UPDATE chains SET dex_router = '0x2626664c2603336E57B271c5C0b26F421741e481' WHERE id = 'base';
UPDATE chains SET dex_router = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45' WHERE id = 'polygon';

INSERT OR IGNORE INTO deploy_presets
  (chain_id, env, label, owner, keeper, router, price_feed, penalty_recipient, fee_recipient, auto_sell_fee_bps, updated_by)
VALUES
  ('arc-mainnet', 'mainnet', 'Arc Mainnet — single owner',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   0, 'seed-2026-11-27'),
  ('bnb', 'mainnet', 'BNB Chain — single owner',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   0, 'seed-2026-11-27'),
  ('base', 'mainnet', 'Base — single owner',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   0, 'seed-2026-11-27'),
  ('ethereum', 'mainnet', 'Ethereum — single owner',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   0, 'seed-2026-11-27'),
  ('polygon', 'mainnet', 'Polygon — single owner',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
   0, 'seed-2026-11-27');
