# StelixVault — Stelix 2.0 Bull Lock contracts

Fresh contracts only. **No V1/V2/V3 legacy.** One new `StelixVault` Solidity
contract for all EVM chains (Arc, BNB, Base, Ethereum, Polygon), plus an
Anchor skeleton for Solana with the same lock model.

Spec: `~/workspace/your_files/stelix-2-0-pitch/stelix-2-0-pitch.pdf`,
Part B (Bull Lock) and Part F (StelixVault). Nothing here is financial
advice and nothing guarantees profit.

## What a Bull Lock does

Lock tokens until the **earlier** of a chosen date or a chosen price target.
On a price target, the due ladder stage is auto-sold to the lock's
stablecoin (USDT on most chains; USDC on Arc where the chain registry says
so — the stablecoin is a per-lock setting, never an assumption) and paid to
the lock owner. Ladder stages (e.g. 25% at 2x, 25% at 3x, 50% at 5x),
trailing stop (10/15/20% fall from peak, armed only after a stage sells),
and break modes Immutable / Penalty (24h cooling-off, 5–10% stored
penalty) / Guardian (48h, **Phase 2 — not enabled yet**).

## Structure

```
contracts/
├── foundry.toml                  # Foundry project, solc 0.8.24, via_ir (see note)
├── README.md                     # this file
├── DEPLOY_ARC_TESTNET.md         # Arc testnet runbook: confirmed addresses, deploy steps, D1 SQL
├── src/
│   ├── StelixVault.sol           # the vault (no external deps by design)
│   ├── adapters/
│   │   ├── UniswapV3TwapFeed.sol     # IPriceFeed from a V3 pool TWAP (Arc has no V2 router / Chainlink feed)
│   │   └── StelixV3RouterAdapter.sol # IDexRouter (V2-style) over the V3 SwapRouter
│   ├── launchpad/
│   │   ├── LaunchToken.sol           # minimal fixed-supply ERC-20
│   │   ├── StelixTokenFactory.sol    # free token creation (gas only)
│   │   └── StelixLaunchpad.sol       # free fixed-price sale, no fee; liquidity release pending DEX manager
│   ├── vendor/
│   │   ├── TickMath.sol          # vendored Uniswap getSqrtRatioAtTick (GPL-2.0)
│   │   └── FullMath.sol          # vendored Uniswap mulDiv (MIT)
│   ├── interfaces/
│   │   ├── IERC20.sol            # minimal ERC-20 interface
│   │   ├── IDexRouter.sol        # swapExactTokensForTokens / getAmountsOut (getAmountsOut is non-view: V3 quoter)
│   │   └── IPriceFeed.sol        # latestPrice / twapPrice (18-dec USD)
│   └── mocks/
│       ├── MockERC20.sol         # mintable test token / stablecoin
│       ├── MockRouter.sol        # fixed-rate test DEX router (+ failing mode)
│       ├── MockPriceFeed.sol     # test-settable spot + TWAP prices
│       ├── MockV3Pool.sol        # test V3 pool with settable TWAP observations
│       └── MockV3Router.sol      # test V3 SwapRouter + QuoterV2 (fixed rate)
├── script/
│   ├── DeployStelixVault.s.sol   # forge deploy script (env-var config only)
│   ├── DeployAdapters.s.sol      # deploy TWAP feed + V3 router adapter
│   ├── DeployLaunchpad.s.sol     # deploy token factory + launchpad
│   ├── deploy-arc-testnet.sh     # Arc testnet FIRST, then the others (runs all three)
│   ├── deploy-bnb-testnet.sh
│   ├── deploy-base-testnet.sh
│   ├── deploy-eth-testnet.sh
│   └── deploy-polygon-testnet.sh
├── test/
│   ├── StelixVault.t.sol         # 21 unit tests (see below)
│   ├── Adapters.t.sol            # 11 tests: TickMath vectors, TWAP feed, V3 adapter, vault-on-V3 e2e
│   └── Launchpad.t.sol           # 10 tests: factory, sale, success + failure flows
└── solana/
    ├── Anchor.toml
    └── programs/stelix_vault/
        ├── Cargo.toml
        └── src/lib.rs            # Anchor SKELETON — Jupiter CPI is a TODO stub
```

## Security properties (in the code, not just policy)

- Reentrancy guards on every fund-moving function; checks-effects-interactions.
- **No admin withdrawal, no emergency drain.** There is no `withdraw` /
  `rescueTokens` function at all (a test asserts low-level calls to those
  selectors fail). Admin config (`pauseNewLocks`, `setKeeper`, `setRouter`,
  `setPriceFeed`, `setAutoSellFee`) can never move locked funds.
- Keeper power is narrow: `executeTrigger` can only swap a *due* stage to
  the lock's stablecoin and pay the lock owner. The keeper supplies **no
  price** — the contract re-checks the 30-minute TWAP from the price feed
  itself, so a fake wick or a compromised keeper cannot force a bad sale.
- **Non-upgradeable by design.** Improvements ship as a new deployment for
  new locks, never as a silent change under existing locks.
- Penalty only on an early break with no trigger met. Target and maturity
  exits are penalty-free by construction.
- Slippage + minimum-receive enforced on every swap; a failed swap reverts
  the whole trigger, leaving the lock untouched (fail-safe, keeper retries).
- Fee: `autoSellFeeBps` is 0 at launch, snapshotted per lock at creation;
  changing it affects only locks created after the change.
- One real bug found by the tests and fixed in the design: a peak-price
  update inside `executeTrigger` was rolled back when the call reverted as
  "not due", so the trailing stop could never arm. The keeper now calls
  `pokePrice(lockId)` on its cron run to record the peak independently;
  `executeTrigger` still updates the peak on successful runs.

## Toolchain

- **Foundry 1.10.0** (`forge`, `cast`, `anvil`). Installed in this VM with
  `curl -L https://foundry.paradigm.xyz | bash && foundryup`.
  Add `export PATH="$PATH:$HOME/.foundry/bin"` to your shell.
- Solidity **0.8.24**, optimizer on (200 runs), `via_ir = true` — required:
  without IR the compiler reports "stack too deep" in the swap helper.
- No external Solidity dependencies: `ReentrancyGuard`, ownership and the
  ERC-20 interface are implemented in-repo, so compilation needs nothing
  beyond Foundry + `forge-std` (already in `lib/`).
- Solana: Anchor 0.30.1 / Solana 1.18.0 (see `solana/`). **Not installed
  in this VM** (no `cargo`/`anchor`), so the Anchor program is a labelled
  skeleton and has not been compiled — see "Still pending".

## Arc testnet reality (verified 2026-11-26 — see DEPLOY_ARC_TESTNET.md)

- **USDC confirmed:** `0x3600000000000000000000000000000000000000` (6 dec,
  native gas + ERC-20, verified `FiatTokenProxy` on testnet.arcscan.app).
- **No V2-style DEX router exists on Arc testnet.** The canonical V2
  router address has no code there. What exists is **Uniswap V3 (Bulba)**:
  SwapRouter `0xfA845604F52843a7b5cfA4030120c6238741F420` (verified),
  factory `0xcD072e113277d1f5460Bf69568f649b26BD01EF9` (verified),
  NonfungiblePositionManager `0xBe9ec79854e459F38E0B868A0c3429AAbf6784b2`.
- **No Chainlink feed address confirmed on Arc testnet** (the Eco-docs
  ETH/USD feed has no code there). The TWAP source is the V3 pools.
- Therefore the vault deploys behind two adapters in `src/adapters/`:
  `UniswapV3TwapFeed` (IPriceFeed from pool `observe()`, TickMath +
  FullMath vendored from Uniswap v3-core) and `StelixV3RouterAdapter`
  (IDexRouter over V3 `exactInputSingle`). Both are covered by
  `test/Adapters.t.sol`, including a vault end-to-end test on the V3
  stack with 6-decimal USDC.
- **The vault assumed 18-decimal stablecoins — fixed 2026-11-26.** On
  Arc (USDC 6 dec) every auto-sell would have reverted on
  `MinReceiveNotMet`. The vault now reads the stablecoin's decimals at
  lock creation and scales `expectedOut`. The constructor also now
  requires a non-zero keeper (a zero keeper would have made triggers
  uncallable forever).
- **No deployment has happened yet:** the VM cannot reach
  `rpc.testnet.arc.network` (egress proxy blocks it) and there is no
  funded testnet deployer key in the workspace. Deploy from a machine
  with RPC access — see `DEPLOY_ARC_TESTNET.md` (one command) — then
  register the addresses in D1. The D1 `chains` row for Arc already
  carries the confirmed USDC + V3 router addresses.

## Launchpad (Arc testnet, free — gas only, no Stelix fee)

`src/launchpad/`: `StelixTokenFactory` creates fixed-supply ERC-20s
(name, symbol, supply, decimals); `StelixLaunchpad` runs fixed-price
sales in USDC (create → contribute → finalize → claim / refund, seller
withdraws raised minus the liquidity reserve). **Liquidity lock:**
`releaseLiquidity` reverts until the owner sets a liquidity manager —
the V3 router is confirmed but no launch-liquidity manager contract
exists yet, so reserves stay locked in the launchpad rather than being
sent anywhere. Covered by `test/Launchpad.t.sol` (10 tests).

## Audit tooling (2026-11-26)

- `forge test`: **42 passed, 0 failed** (21 vault + 11 adapters + 10 launchpad).
- **Slither 0.11.6** (installed in a venv for this run): 71 findings
  across the six production contracts, **no HIGH / exploitable issue**.
  The `reentrancy-no-eth` flag on `executeTrigger` is a false positive
  (`nonReentrant` + state updates precede the swap call). Two real
  issues found by the review were fixed (stablecoin decimals, keeper
  zero-check). The rest are informational / by-design (block.timestamp
  for unlocks + cooling-off, vendored Uniswap math, naming). Slither is
  NOT a substitute for an independent human audit — still required
  before mainnet value.
- Keeper (`apps/keeper`): wired to D1 + viem (see its README); 24 tests
  passing, typecheck clean.

## Compile & test

```bash
cd ~/workspace/stelix-v2/contracts
export PATH="$PATH:$HOME/.foundry/bin"
forge build
forge test -vv
```

Result in this VM (2026-11-26): `forge build` succeeds (solc 0.8.24);
`forge test` — **42 passed, 0 failed**. Coverage includes: createLock
terms + bad-ladder + paused reverts; claim after maturity (revert before,
owner-only); keeper-only trigger; trigger below target reverts; target
auto-sell to USDT (1000 tokens @ $2 → 2000 USDT); autoSell-off unlocks
tokens unsold; 3-stage ladder partial sells (25% @2x, 25% @3x, 50% @5x);
trailing stop (peak $3, −13.3% → sells remainder); trailing stop not
armed before any stage sells; Immutable break reverts; Penalty break
after 24h cooling-off (950 back, 50 penalty on 1000); break without
request reverts; Guardian break reverts as Phase 2; minimum-receive
revert leaves the lock untouched; failed-swap fail-safe + keeper retry;
no admin withdrawal function; manual `claimTriggeredStage` owner path
(the manual unlock when a trigger is met but the keeper/swap is down).

## Deploy to testnet (Arc testnet first)

Testnet only. Nothing here has been deployed — no mainnet deploy, no
testnet deploy yet. Per chain, fill the env vars (never commit keys):

```bash
RPC_URL=<testnet rpc> PRIVATE_KEY=<deployer key, env/secret store only> \
KEEPER=<keeper address> ROUTER=<dex router> PRICE_FEED=<twap/oracle> \
PENALTY_RECIPIENT=<treasury or burn address> AUTO_SELL_FEE_BPS=0 \
./script/deploy-arc-testnet.sh
# or: forge script script/DeployStelixVault.s.sol --rpc-url "$RPC_URL" --broadcast --verify
```

Then, per chain (pitch Part F):
1. Verify source + ABI on the explorer (`--verify` above, or one-click in
   the admin Contract Studio later).
2. Record chain, address, tx hash, compiler version (0.8.24, via_ir,
   optimizer 200) and artifact hash.
3. Register the verified address in the admin Chain Manager; the app picks
   it up on its next signed-config fetch. Only then does the chain flip
   to Live in the app.
4. Test the full flow on testnet with small amounts: lock → target hit →
   USDT received; maturity claim; break flows.

Per-chain notes: the exit stablecoin is a registry setting — confirm USDT
availability on Arc at build time, otherwise USDC labelled clearly in-app.
Router and price-feed (TWAP adapter / Chainlink where available) addresses
differ per chain and must be set per deployment; a production price feed
adapter implementing `IPriceFeed` (DEX TWAP, 30-min window) still needs to
be built — the mocks here are test-only.

## Mainnet checklist (NOT done — do not skip)

1. Independent audit of the **exact compiled artifact** that will deploy;
   fix findings, recompile, re-verify — deployed hash must match audited hash.
2. Testnet flow passed on every chain (step 4 above).
3. Small-value mainnet smoke lock by the owner first: lock, wait for a low
   test target, confirm USDT arrives.
4. Mainnet deploy from the admin Contract Studio with the typed
   confirmation naming chain + gas; register + verify as above.

## Still pending

- Independent security audit (required before meaningful mainnet value).
- Production `IPriceFeed` TWAP adapter per chain (DEX TWAP / Chainlink);
  keeper service (Cloudflare Worker cron calling `pokePrice` +
  `executeTrigger`); admin Contract Studio wiring.
- Solana: finish the Anchor program (Jupiter Aggregator v6 CPI, PDA-signed
  vault transfers, TWAP/oracle check, keeper config account), `anchor build`
  + devnet deploy + tests. Currently a skeleton that deliberately errors
  on `execute_trigger`.
- Any mainnet or testnet deployment (none performed here).
- Decisions from the pitch (p.19) still open: Arc exit stablecoin
  confirmation, default break mode, auto-sell fee %, audit provider/budget.
