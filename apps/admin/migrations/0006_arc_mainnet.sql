-- Stelix 2.0 Admin — migration 0006: Arc mainnet chain row, Arc testnet
-- endpoint refresh, and restore of all chains to active scope.
-- Apply AFTER 0005_add_chain_fields.sql (it adds is_testnet / active /
-- paired_chain_id, which this migration fills in for the Arc pair):
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0005_add_chain_fields.sql
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0006_arc_mainnet.sql
--
-- Verified values (checked 2026-11-27, do not invent others):
-- docs.arc.io "Connect to Arc" + "RPC endpoints": Arc mainnet chain 5042,
-- https://rpc.mainnet.arc.io, https://explorer.arc.io (live since
-- 2026-09-16, Circle); testnet chain 5042002,
-- https://rpc.testnet.arc.io, https://explorer.testnet.arc.io. The old
-- endpoints rpc.testnet.arc.network / testnet.arcscan.app are
-- decommissioned.
-- USDC 0x3600000000000000000000000000000000000000 is the same predeploy
-- on both Arc networks (6 decimals, also the gas token).
-- Arc mainnet Uniswap V3 SwapRouter02
-- 0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77 (Factory
-- 0xf0db7b58379503491d857dB50AC9ece64c653918). The vault speaks V2-style
-- IDexRouter, so a V3 adapter (contracts/src/adapters/
-- StelixV3RouterAdapter.sol) sits between the vault and this router.
-- Arc testnet V3 router 0xfA845604F52843a7b5cfA4030120c6238741F420 is the
-- full address already in this repo
-- (contracts/script/DeployAdapters.s.sol).
--
-- Scope: user decision 2026-11-27 03:03 WAT — "Don't remove them,
-- include them back, lets work with all chains from beginning." The five
-- chains below go from status 'hidden' back to 'live'.

-- Arc testnet row: decommissioned endpoints replaced, name clarified.
UPDATE chains SET
  name = 'Arc Testnet',
  rpc_urls = 'https://rpc.testnet.arc.io',
  explorer_url = 'https://explorer.testnet.arc.io',
  stablecoin_address = '0x3600000000000000000000000000000000000000',
  dex_router = '0xfA845604F52843a7b5cfA4030120c6238741F420'
WHERE id = 'arc';

-- Arc mainnet row (new). No vault is deployed on it yet (vault_address
-- NULL) and no independent audit exists yet — mainnet deploy stays fully
-- gated in Contract Studio and in the Worker.
INSERT OR IGNORE INTO chains (id, name, chain_id, rpc_urls, explorer_url, native_token, native_decimals, stablecoin, stablecoin_address, stablecoin_decimals, gas_token, dex_router, vault_address, status, is_testnet, active, paired_chain_id, is_default) VALUES
('arc-mainnet', 'Arc Mainnet', 5042, 'https://rpc.mainnet.arc.io', 'https://explorer.arc.io', 'USDC', 6, 'USDC', '0x3600000000000000000000000000000000000000', 6, 'USDC', '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77', NULL, 'live', 0, 1, 'arc', 0);

-- Pair the two Arc rows (testnet <-> mainnet).
UPDATE chains SET paired_chain_id = 'arc-mainnet', is_testnet = 1 WHERE id = 'arc';
UPDATE chains SET paired_chain_id = 'arc', is_testnet = 0, active = 1 WHERE id = 'arc-mainnet';

-- Restore all chains to active scope.
UPDATE chains SET status = 'live' WHERE id IN ('bnb', 'base', 'ethereum', 'polygon', 'solana') AND status = 'hidden';
