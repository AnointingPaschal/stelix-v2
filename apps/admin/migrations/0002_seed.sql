-- Stelix 2.0 Admin — migration 0002: login rate-limit table + seed chains.
-- Apply: wrangler d1 execute stelix-admin-db --file=migrations/0002_seed.sql
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_until TEXT
);

-- Seed chains (spec Part E): Arc is the default chain; others start hidden.
-- Real RPC/explorer/stablecoin values are filled in by the owner before a
-- chain is set live; vault_address is NULL until a contract is deployed.
INSERT OR IGNORE INTO chains (id, name, chain_id, rpc_urls, explorer_url, native_token, stablecoin, stablecoin_address, dex_router, vault_address, status, is_default) VALUES
('arc', 'Arc', 5042002, 'https://rpc.testnet.arc.network', 'https://testnet.arcscan.app', 'USDC', 'USDC', '', '', NULL, 'testnet', 1),
('bnb', 'BNB Smart Chain', 56, 'https://bsc-dataseed.bnbchain.org', 'https://bscscan.com', 'BNB', 'USDT', '', '', NULL, 'hidden', 0),
('base', 'Base', 8453, 'https://mainnet.base.org', 'https://basescan.org', 'ETH', 'USDC', '', '', NULL, 'hidden', 0),
('ethereum', 'Ethereum', 1, 'https://eth.llamarpc.com', 'https://etherscan.io', 'ETH', 'USDC', '', '', NULL, 'hidden', 0),
('polygon', 'Polygon', 137, 'https://polygon-rpc.com', 'https://polygonscan.com', 'MATIC', 'USDC', '', '', NULL, 'hidden', 0),
('solana', 'Solana', 101, 'https://api.mainnet-beta.solana.com', 'https://solscan.io', 'SOL', 'USDC', '', '', NULL, 'hidden', 0);
