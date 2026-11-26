# Stelix — Arc testnet deployment runbook (Workstream C)

Testnet only. Nothing in this runbook deploys to mainnet.

## 1. Confirmed Arc testnet facts (verified 2026-11-26)

All addresses below were checked against the Blockscout API at
`https://testnet.arcscan.app/api/v2/addresses/<address>` (the public RPC
`https://rpc.testnet.arc.network` is NOT reachable from this VM — the
egress proxy blocks it — so live deployment must run from a machine with
direct RPC access, or after the proxy allows the RPC host).

| Item | Address | Status |
| --- | --- | --- |
| Chain | `5042002` (Arc Testnet) | confirmed, chain id + explorer |
| RPC | `https://rpc.testnet.arc.network` | documented, unreachable from this VM |
| Explorer | `https://testnet.arcscan.app` | confirmed (Blockscout API reads work) |
| USDC (native gas + ERC-20) | `0x3600000000000000000000000000000000000000` | **CONFIRMED** — verified contract, name `FiatTokenProxy`, implementation `NativeFiatTokenV2_2`, ERC-20, 6 decimals, symbol USDC. Explorer: https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000 |
| DEX router (V2-style) | — | **NOT FOUND** — the canonical Uniswap V2 router `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` has NO code on testnet (that address is Arc mainnet, chain 5042). StelixVault speaks V2-style `IDexRouter`, so it cannot point at a V2 router on testnet. |
| DEX router (V3) | `0xfA845604F52843a7b5cfA4030120c6238741F420` | **CONFIRMED** — verified source is the genuine Uniswap V3 `SwapRouter` (GPL-2.0, Solidity 0.7.6). Factory (BulbaV3Factory) `0xcD072e113277d1f5460Bf69568f649b26BD01EF9` verified. NonfungiblePositionManager `0xBe9ec79854e459F38E0B868A0c3429AAbf6784b2` verified. BiscottiSmartRouter `0xa95dF5a9cE06f15371bd0A68CdB91d960a871B5E` verified. |
| QuoterV2 | `0x3Ce954107b1A675826B33bF23060Dd655e3758fE` | Contract exists but source is **UNVERIFIED** — do not set as quoter until verified. `getAmountsOut` reverts until a quoter is set. |
| Price feed (Chainlink) | — | **NOT FOUND as a usable address** — Chainlink is live on Arc (arc.io + Chainlink changelog 2026-11-23) but no per-token feed address on Arc TESTNET could be confirmed. The Eco-docs ETH/USD feed `0x50FCDD99D6762D1C170DC6A9111db944AEE6D364` has NO code on testnet. |
| Price feed (TWAP source) | Uniswap V3 pools via `BulbaV3Factory` | **CONFIRMED as the source** — the `UniswapV3TwapFeed` adapter in `src/adapters/` reads pool TWAP via `observe()`. A pool must exist for the token/USDC pair with real liquidity before the vault can use it. |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | verified FiatTokenProxy (extra, not used by the vault) |

**Consequence:** the vault deploys pointing at the two adapters, NOT at a
native router/feed:
- `router` = `StelixV3RouterAdapter` (V2-style interface over the V3 SwapRouter)
- `priceFeed` = `UniswapV3TwapFeed` (V3 pool TWAP, 30-min window)

## 2. What is NOT deployed yet (and why)

No contract has been deployed to Arc testnet in this workstream, because
two inputs are missing and cannot be invented:
1. **RPC access** — `rpc.testnet.arc.network` (and `rpc.testnet.arc.io`,
   dRPC, Blast, Ankr) is unreachable from this VM (timeouts / empty
   replies through the egress proxy). The explorer API works for reads,
   but its `/api/eth-rpc` endpoint rejects requests (`Id is a required
   field` / 400) and cannot broadcast.
2. **A funded testnet-only deployer key** — no deployer private key exists
   in this workspace and none may be written to code/logs. The coordinator
   must supply a testnet-only key (env / secret store) and fund that
   address with testnet USDC from https://faucet.circle.com (Arc Testnet).

Once both exist, deployment is one command (below). Everything else —
contracts, adapters, tests (42 passing), Slither, keeper wiring, D1 SQL —
is done and waiting.

## 3. Deploy (from a machine with RPC access)

```bash
cd ~/workspace/stelix-v2/contracts
export PATH="$PATH:$HOME/.foundry/bin"
RPC_URL=https://rpc.testnet.arc.network \
PRIVATE_KEY=$TESTNET_DEPLOYER_KEY \
KEEPER=<dedicated testnet keeper address> \
./script/deploy-arc-testnet.sh
```

This runs, in order: `DeployAdapters` → `DeployStelixVault`
(needs `ROUTER` + `PRICE_FEED` env set to the adapter addresses printed
by step 1) → `DeployLaunchpad`. Or run each forge script individually:

```bash
# 1. Adapters
USDC=0x3600000000000000000000000000000000000000 \
V3_ROUTER=0xfA845604F52843a7b5cfA4030120c6238741F420 \
forge script script/DeployAdapters.s.sol --rpc-url $RPC_URL --broadcast --verify

# 2. Vault (owner = deployer; keeper = KEEPER; fee 0 at launch)
KEEPER=<keeper> ROUTER=<adapter> PRICE_FEED=<feed> \
PENALTY_RECIPIENT=0x0000000000000000000000000000000000000000 \
AUTO_SELL_FEE_BPS=0 \
forge script script/DeployStelixVault.s.sol --rpc-url $RPC_URL --broadcast --verify

# 3. Launchpad
USDC=0x3600000000000000000000000000000000000000 \
forge script script/DeployLaunchpad.s.sol --rpc-url $RPC_URL --broadcast --verify
```

Constructor args to record for the vault: owner = deployer address,
keeper = KEEPER, router = adapter address, priceFeed = feed address,
penaltyRecipient / feeRecipient = as set (0 at launch), autoSellFeeBps = 0.

After deploy, per contract:
1. Verify source + ABI on https://testnet.arcscan.app (`--verify` above,
   or the explorer UI).
2. Register in D1 (section 4) and note chain, address, tx hash, compiler
   (solc 0.8.24, via_ir, optimizer 200), artifact hash.
3. Register pools on the TWAP feed: `feed.setPool(token, pool, decimals)`
   for each token/USDC Bulba pool (owner-only; deployer is the owner until
   ownership is transferred to the vault owner/multisig).
4. Smoke-test on testnet with small amounts: lock → target hit → USDC
   received; maturity claim; break flows. Only then does the chain flip
   to Live in the app.

## 4. D1 registration (admin Chain Manager)

Database: `stelix-admin-db` (`598cd9fd-a29b-4286-b99d-f51c534d0308`).
The `chains` row for Arc already exists (seeded); the confirmed router /
stablecoin values can be recorded now, the vault address after deploy:

```sql
-- ALREADY APPLIED 2026-11-26 (Workstream C): the Arc row now carries the
-- confirmed stablecoin + V3 router. Do not re-run blindly.
UPDATE chains
SET stablecoin_address = '0x3600000000000000000000000000000000000000',
    dex_router = '0xfA845604F52843a7b5cfA4030120c6238741F420',
    updated_at = datetime('now')
WHERE id = 'arc';

-- Run after deploy: register the vault + the three other contracts.
-- Replace <VAULT>, <FEED>, <ADAPTER>, <FACTORY>, <LAUNCHPAD>, <TXHASH>.
UPDATE chains SET vault_address = '<VAULT>', updated_at = datetime('now') WHERE id = 'arc';

INSERT INTO deployments (chain_id, address, tx_hash, compiler_version, bytecode_hash, parameters_json, verification_status, env)
VALUES
('arc', '<VAULT>',    '<TXHASH>', '0.8.24 (via_ir, optimizer 200)', NULL, '{"contract":"StelixVault","router":"<ADAPTER>","priceFeed":"<FEED>","autoSellFeeBps":0}', 'pending', 'testnet'),
('arc', '<FEED>',     '<TXHASH>', '0.8.24 (via_ir, optimizer 200)', NULL, '{"contract":"UniswapV3TwapFeed","usdc":"0x3600000000000000000000000000000000000000"}', 'pending', 'testnet'),
('arc', '<ADAPTER>',  '<TXHASH>', '0.8.24 (via_ir, optimizer 200)', NULL, '{"contract":"StelixV3RouterAdapter","swapRouter":"0xfA845604F52843a7b5cfA4030120c6238741F420"}', 'pending', 'testnet'),
('arc', '<FACTORY>',  '<TXHASH>', '0.8.24 (via_ir, optimizer 200)', NULL, '{"contract":"StelixTokenFactory"}', 'pending', 'testnet'),
('arc', '<LAUNCHPAD>','<TXHASH>', '0.8.24 (via_ir, optimizer 200)', NULL, '{"contract":"StelixLaunchpad","stablecoin":"0x3600000000000000000000000000000000000000"}', 'pending', 'testnet');
```

Set `verification_status = 'verified'` per row once the explorer shows
the contract as verified.

## 5. Launchpad liquidity — pending, by design

`StelixLaunchpad.releaseLiquidity` reverts with `LiquidityNotReady()` until
the owner sets a liquidity manager (`setLiquidityManager`). The V3
SwapRouter + NonfungiblePositionManager are confirmed on testnet, but no
launch-liquidity manager contract has been written or audited, so the
reserves stay locked in the launchpad rather than being sent anywhere.
Do not present a launch as "liquidity locked on a DEX" until a manager is
deployed and a pool actually holds the liquidity.

## 6. Known findings fixed in this workstream

- **Vault assumed 18-decimal stablecoins (HIGH for Arc).** `_exitStage`
  computed `expectedOut` in 18-dec units; Arc USDC is 6-dec, so every
  auto-sell would have reverted on `MinReceiveNotMet`. Fixed: the vault
  now reads the stablecoin's decimals at lock creation (stored per lock)
  and scales `expectedOut` down. Proven by
  `testVaultEndToEndViaV3With6DecUsdc` (1000 tokens → 2000 USDC).
- **Vault constructor did not require a keeper.** A zero keeper would
  have made `executeTrigger`/`pokePrice` uncallable forever. Fixed with
  `require(_keeper != address(0))`.
- **Slither** (0.11.6, full report in the workstream report): no HIGH /
  exploitable findings. The `reentrancy-no-eth` flag on `executeTrigger`
  is a false positive — the function is `nonReentrant` and all state
  updates precede the external swap call. Remaining flags are
  informational / by-design (block.timestamp for unlocks + cooling-off,
  vendored Uniswap math, naming).
