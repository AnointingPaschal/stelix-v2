-- Stelix 2.0 Admin — migration 0004: launchpad tables (no sample data).
-- Apply: wrangler d1 execute stelix-admin-db --remote --file=migrations/0004_launches.sql
-- All tables start EMPTY. The admin shows a real empty state until a launch
-- is recorded. Never seed sample launches here.
--
-- A launch is recorded by the admin only after it exists on-chain
-- (StelixLaunchpad.createLaunch on Arc testnet) — sale_id is the on-chain
-- sale id, NULL until the deploy is confirmed. approval_status is the
-- admin's listing decision (pending by default); it never invents a sale.
-- Amounts are micro-USDC text (Arc USDC, 6 decimals), matching the
-- contract: price_per_token = micro-USDC per ONE WHOLE token.
-- start_time / end_time are epoch seconds.
--
-- Liquidity: liquidity_manager stays NULL until a liquidity-manager
-- contract is set on StelixLaunchpad (pending Arc DEX confirmation).
-- Until then the reserve stays locked in the launchpad — never present
-- a launch as "liquidity locked on a DEX".

CREATE TABLE IF NOT EXISTS launches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER,
  chain_id TEXT NOT NULL DEFAULT 'arc',
  seller TEXT NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL DEFAULT '',
  token_name TEXT NOT NULL DEFAULT '',
  token_decimals INTEGER NOT NULL DEFAULT 18,
  logo_url TEXT,
  price_per_token TEXT NOT NULL DEFAULT '0',
  soft_cap TEXT NOT NULL DEFAULT '0',
  hard_cap TEXT NOT NULL DEFAULT '0',
  raised TEXT NOT NULL DEFAULT '0',
  tokens_sold TEXT NOT NULL DEFAULT '0',
  contributors INTEGER NOT NULL DEFAULT 0,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  liquidity_lock_bps INTEGER NOT NULL DEFAULT 0,
  tokens_for_sale TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL DEFAULT 'Active',
  finalized INTEGER NOT NULL DEFAULT 0,
  approval_status TEXT NOT NULL DEFAULT 'pending',
  liquidity_manager TEXT,
  liquidity_released INTEGER NOT NULL DEFAULT 0,
  tx_hash TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_launches_chain ON launches(chain_id, created_at);
CREATE INDEX IF NOT EXISTS idx_launches_status ON launches(status, approval_status);
CREATE INDEX IF NOT EXISTS idx_launches_sale ON launches(chain_id, sale_id);

-- Contributions recorded per launch (keeper indexer or manual admin entry).
-- amount is micro-USDC text. One row per contribution transaction.
CREATE TABLE IF NOT EXISTS launch_contributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  launch_id INTEGER NOT NULL,
  contributor TEXT NOT NULL,
  amount TEXT NOT NULL DEFAULT '0',
  tx_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_launch_contribs_launch ON launch_contributions(launch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_launch_contribs_user ON launch_contributions(contributor);

-- Launchpad contract addresses on the Arc chain row, filled only after a
-- verified testnet deploy (same rule as chains.vault_address).
ALTER TABLE chains ADD COLUMN launchpad_address TEXT;
ALTER TABLE chains ADD COLUMN token_factory_address TEXT;
