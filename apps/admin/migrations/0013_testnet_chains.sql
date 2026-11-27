-- Stelix 2.0 Admin — migration 0013: testnet chain rows for every EVM
-- chain, so Contract Studio can deploy adapters + vault from the admin
-- on testnet, just as Arc Testnet already does. Apply:
--   wrangler d1 execute stelix-admin-db --remote --file=migrations/0013_testnet_chains.sql
--
-- Verified values (checked 2026-11-27, do not invent others):
-- BNB Testnet (97): RPC https://bsc-testnet-dataseed.bnbchain.org,
--   explorer https://testnet.bscscan.com, tBNB faucet
--   https://testnet.bnbchain.org/faucet-smart. Router
--   0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3 is the PancakeRouter on
--   testnet BscScan — verified source, 153,719 txs, swaps hours ago.
--   A second PancakeRouter 0xD99D1c33F9fC3444f8101754aBC46c52416550D1
--   also exists and is active, but has far fewer txs; the 153k-tx
--   router is the one with the liquidity/history. No official USDT on
--   BNB testnet; BUSD test token
--   0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7 (18 decimals, verified
--   on testnet BscScan, ~70,400 holders) is the exit stablecoin for
--   testnet only — it is a test token, not issuer-backed BUSD.
-- Base Sepolia (84532): RPC https://sepolia.base.org, explorer
--   https://sepolia.basescan.org, USDC
--   0x036CbD53842c5426634e7929541eC2318f3dCF7e (6 dec, Circle docs),
--   V3 SwapRouter02 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4
--   (Uniswap docs). No V2 router on Base Sepolia — V3 adapter only.
--   Caveat: its exactInputSingle may differ from Arc's V3 router;
--   the adapter must be tested against it before real value is locked.
-- Ethereum Sepolia (11155111): RPC https://rpc.sepolia.org, explorer
--   https://sepolia.etherscan.io, USDC
--   0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 (6 dec, Circle docs),
--   V2 Router02 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3 (Uniswap
--   official V2 deployments page). The old candidate
--   0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D is mainnet/Goerli only —
--   NEVER use it on Sepolia. V3 SwapRouter02
--   0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E also exists.
-- Polygon Amoy (80002): RPC https://rpc-amoy.polygon.technology,
--   explorer https://amoy.polygonscan.com, gas is POL (not MATIC),
--   USDC 0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582 (6 dec, Circle
--   docs). Router is LEFT BLANK on purpose: the V3 router addresses
--   found are unverified secondary claims only, no V2 router found,
--   and no Chainlink feed address was found at all. Contract Studio
--   must refuse to deploy on Amoy until a router is verified on
--   amoy.polygonscan.com.
--
-- Mainnet rows filled in where verified (already in the repo's mobile
-- registry): BNB USDT + PancakeSwap V2 router, Base USDC, Ethereum
-- USDT, Polygon USDT. Mainnet routers for Base/Ethereum/Polygon are
-- left blank — unverified in this project, never guess.
-- Deploy presets seeded for the four testnets (owner/penalty/fee =
-- the user's test address, keeper/router/price_feed blank until the
-- adapters are deployed from the admin).

INSERT OR IGNORE INTO chains (id, name, chain_id, rpc_urls, explorer_url, native_token, native_decimals, stablecoin, stablecoin_address, stablecoin_decimals, gas_token, dex_router, vault_address, status, is_testnet, active, paired_chain_id, is_default) VALUES
('bnb-testnet', 'BNB Testnet', 97, 'https://bsc-testnet-dataseed.bnbchain.org', 'https://testnet.bscscan.com', 'tBNB', 18, 'BUSD', '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', 18, 'tBNB', '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3', NULL, 'testnet', 1, 1, 'bnb', 0),
('base-sepolia', 'Base Sepolia', 84532, 'https://sepolia.base.org', 'https://sepolia.basescan.org', 'ETH', 18, 'USDC', '0x036CbD53842c5426634e7929541eC2318f3dCF7e', 6, 'ETH', '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4', NULL, 'testnet', 1, 1, 'base', 0),
('ethereum-sepolia', 'Ethereum Sepolia', 11155111, 'https://rpc.sepolia.org', 'https://sepolia.etherscan.io', 'ETH', 18, 'USDC', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 6, 'ETH', '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3', NULL, 'testnet', 1, 1, 'ethereum', 0),
('polygon-amoy', 'Polygon Amoy', 80002, 'https://rpc-amoy.polygon.technology', 'https://amoy.polygonscan.com', 'POL', 18, 'USDC', '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', 6, 'POL', '', NULL, 'testnet', 1, 1, 'polygon', 0);

UPDATE chains SET paired_chain_id = 'bnb-testnet' WHERE id = 'bnb';
UPDATE chains SET paired_chain_id = 'base-sepolia' WHERE id = 'base';
UPDATE chains SET paired_chain_id = 'ethereum-sepolia' WHERE id = 'ethereum';
UPDATE chains SET paired_chain_id = 'polygon-amoy' WHERE id = 'polygon';

UPDATE chains SET stablecoin_address = '0x55d398326f99059fF775485246999027B3197955', dex_router = '0x10ED43C718714eb63d5aA57B78B54704E256024E' WHERE id = 'bnb';
UPDATE chains SET stablecoin_address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029' WHERE id = 'base';
UPDATE chains SET stablecoin = 'USDT', stablecoin_address = '0xdAC17F958D2ee523a2206206994597C13D831ec7' WHERE id = 'ethereum';
UPDATE chains SET stablecoin_address = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F' WHERE id = 'polygon';

INSERT OR IGNORE INTO deploy_presets (chain_id, env, label, owner, keeper, router, price_feed, penalty_recipient, fee_recipient, auto_sell_fee_bps, updated_by) VALUES
('bnb-testnet', 'testnet', 'BNB Testnet — single owner test', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', 0, 'seed-2026-11-27'),
('base-sepolia', 'testnet', 'Base Sepolia — single owner test', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', 0, 'seed-2026-11-27'),
('ethereum-sepolia', 'testnet', 'Ethereum Sepolia — single owner test', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', 0, 'seed-2026-11-27'),
('polygon-amoy', 'testnet', 'Polygon Amoy — single owner test', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '', '', '', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383', 0, 'seed-2026-11-27');
