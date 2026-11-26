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

## Wiring status (2026-11-26, Workstream C)
- **Wired:** D1 `locks` reads (`fetchActiveLocks` — chain `locks` table +
  on-chain `getLock` enrichment), on-chain TWAP via the vault's price
  feed (`fetchPricePoints` — the feed's 30-min TWAP is the price point;
  the keeper never invents a price), stage-swap simulation via the
  router adapter's quoter (`simulateStageSwap`, impact measured against
  the TWAP reference), `pokePrice` + `executeTrigger` signing with viem
  (`sendTrigger`), D1 `keeper_runs` logging, and the admin hooks:
  `POST /run` (Run Now), `POST /pause` + `POST /resume` (write
  `keeper_state`), `GET /status` (pause state + recent runs). The cron
  checks `keeper_state.paused` before every run. `wrangler.toml` now
  points at the real D1 database (`598cd9fd-a29b-4286-b99d-f51c534d0308`).
  Tests: 24 passing (`test/keeper.test.ts` + `test/keeper-wiring.test.ts`),
  `tsc --noEmit` clean, `npm run build` (wrangler dry-run) passes.
- **Still missing for a live run (do NOT fake it):** `VAULT_ADDRESS_ARC`
  (no vault deployed yet — RPC + funded testnet deployer are blocked,
  see `contracts/DEPLOY_ARC_TESTNET.md`), `KEEPER_PRIVATE_KEY` secret,
  and a verified quoter for the router adapter (without it, simulation
  returns null and the keeper retries instead of triggering). With no
  vault configured, a run logs "not configured" and does nothing.
- **Admin auth on /run, /pause, /resume is still TODO** — those endpoints
  currently accept any caller that can reach the Worker URL. Put the
  Worker behind the admin's auth (or a shared secret header) before
  exposing it.

## Pending
- A verified V3 quoter address on Arc testnet (the `0x3Ce95410...`
  candidate is a live contract but its source is unverified).
- Redundant backup runner; live Cloudflare deploy.
