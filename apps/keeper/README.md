# Stelix 2.0 — Keeper Service

Cloudflare Worker on a cron schedule (every 5 minutes), per spec Part G.

## Flow (per run, per chain)
1. Fetch active locks with price targets (D1 / indexer).
2. Compute the 30-minute TWAP from the DEX pair (Chainlink where the registry provides a feed). Below target: nothing happens.
3. At/above target for the required window, or trailing-stop breached after a peak → simulate the stage swap. If price impact or expected receive fails the guards, log + notify + retry next run — never force a bad sell.
4. Call `StelixVault.executeTrigger(lockId)`. The contract re-checks conditions and limits on-chain, swaps, and pays the stablecoin to the lock owner.
5. Record the result in D1 `keeper_runs`, send the push notification; the lock stage shows as Sold in the app.

## Guards (unit-tested, `test/keeper.test.ts`)
- **TWAP guard** — a 1-minute wick cannot fire a sell; the 30-min average must hold above target.
- **Price-impact guard** — default limit 5% (500 bps); over it, pause + notify + retry.
- **Minimum-receive guard** — swap must meet the lock's `minReceivePerStage`.
- **Trailing stop** — fall of the chosen % (10/15/20%) from peak auto-sells the remainder.
- **Fail-safe retry** — exponential backoff (60s → 15 min cap), max 3 retries, then pause + notify. A failed swap never leaves funds half-sold: the lock stays locked.

## Safety
The keeper key can **only** call `executeTrigger()`; it cannot move funds anywhere except the swap-to-stablecoin / unlock-to-owner paths coded in the contract. The key is a Cloudflare secret (`KEEPER_PRIVATE_KEY`) — never in code. A redundant external runner is the backup (spec Part G); date exits need no keeper at all.

## Run locally
```bash
npm install
npm test            # vitest — TWAP, impact, trailing stop, retry/fail-safe
npm run typecheck   # tsc --noEmit
npm run build       # tsc --noEmit && wrangler deploy --dry-run
```

## Deploy (NOT done in this local build — pending owner decision)
```bash
npx wrangler secret put KEEPER_PRIVATE_KEY
npx wrangler deploy
```

## Pending
Wire `fetchActiveLocks` / `fetchPricePoints` / `simulateSwap` / `executeTriggerOnChain` in `src/index.ts` to the D1 indexer, DEX router quotes and the deployed vault addresses; Chainlink feeds per registry; redundant backup runner; live Cloudflare deploy.
