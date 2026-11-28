-- Stelix 2.0 Admin — migration 0019: coming-soon chains + Plasma + Pi.
-- coming_soon: the admin can mark a chain "coming soon". The wallet shows
-- it in the picker with a badge but disabled — it can never be selected,
-- and no balance/swap/lock call is made for it. This is how a chain is
-- announced before its vault/router is ready (Plasma testnet, Pi).
ALTER TABLE chains ADD COLUMN coming_soon INTEGER NOT NULL DEFAULT 0;

-- Plasma Mainnet (9745): EVM, Uniswap V3. Verified on-chain 2026-11-28:
-- USDT0 0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb (symbol USDT0, 6 dec),
-- USDC 0x2d661c89d812261039af9764eceaaee884f5f67f (symbol USDC, 6 dec,
-- token0 of the USDC/USDT0 0.01% pool 0x56cf5fc8a6d04f52df99752eed255ee8a64504de),
-- SwapRouter02 0x807F4E281B7A3B324825C64ca53c69F0b418dE40 (24,497 bytes of
-- code; canonical Uniswap V3 deployment, GFX Labs, Sept 2025, per the
-- official Uniswap governance deployments list). Vault not deployed yet.
-- Gas is XPL (18 dec). Public RPC is rate-limited, not for production.
INSERT OR IGNORE INTO chains (id, name, chain_id, rpc_urls, explorer_url, native_token, native_decimals, stablecoin, stablecoin_address, stablecoin_decimals, gas_token, dex_router, vault_address, status, is_testnet, active, paired_chain_id, is_default, coming_soon) VALUES
('plasma', 'Plasma', 9745, 'https://rpc.plasma.to', 'https://plasmascan.to', 'XPL', 18, 'USDT0', '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', 6, 'XPL', '0x807F4E281B7A3B324825C64ca53c69F0b418dE40', NULL, 'live', 0, 1, 'plasma-testnet', 0, 0),
-- Plasma Testnet (9746): no verified router or stablecoin on testnet yet
-- (testnet USDT0 still in development) — coming soon until verified.
('plasma-testnet', 'Plasma Testnet', 9746, 'https://testnet-rpc.plasma.to', 'https://testnet.plasmascan.to', 'XPL', 18, 'USDT0', '', 6, 'XPL', '', NULL, 'testnet', 1, 1, 'plasma', 0, 1),
-- Pi Network Mainnet: NOT EVM. Stellar-based chain (Stellar Core, SCP);
-- Horizon API https://api.mainnet.minepi.com, explorer
-- https://blockexplorer.minepi.com, native PI (7 decimals, Stellar
-- convention). Addresses are Stellar G... addresses, not 0x. No smart
-- contracts for third parties yet (Pi Core Team: contract functionality
-- internal-only as of Oct 2026; mainnet on Protocol v28). No DEX router,
-- no stablecoin, no vault possible — a Pi vault would need a separate
-- Soroban (Rust) build, like Solana. chain_id 0 = non-EVM sentinel.
-- Coming soon until Pi opens contracts to third parties.
('pi', 'Pi Network', 0, 'https://api.mainnet.minepi.com', 'https://blockexplorer.minepi.com', 'PI', 7, '', '', 7, 'PI', '', NULL, 'live', 0, 1, 'pi-testnet', 0, 1),
-- Pi Testnet: Horizon https://api.testnet.minepi.com. Same limits as mainnet.
('pi-testnet', 'Pi Testnet', 0, 'https://api.testnet.minepi.com', 'https://blockexplorer.minepi.com', 'PI', 7, '', '', 7, 'PI', '', NULL, 'testnet', 1, 1, 'pi', 0, 1);
