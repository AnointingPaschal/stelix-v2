# Stelix 2.0 — Your Financial Discipline

A non-custodial, multichain crypto vault wallet that locks funds so they cannot be spent on impulse — and automatically sells to USDT when your bull-market price target is reached, before the price falls back.

> **Lock it. Forget it. Sell the top of your plan — automatically.**
> Stelix locks your crypto until your date or your price target, then sells to USDT for you, even while you sleep.
>
> **No guaranteed profit.** Stelix never guarantees profit. Prices can fall as well as rise. Trading involves substantial risk of loss. Stelix guarantees only what the contract enforces: locked funds cannot be spent early except under the break rules you chose, and a confirmed price target triggers the exit you set.

Full pitch and pre-production spec: `~/workspace/your_files/stelix-2-0-pitch/stelix-2-0-pitch.pdf` (19 pages, November 2026).

## What is in this repo

```
stelix-v2/
├── apps/mobile/     Expo SDK 58, TypeScript, Expo Router — the wallet (18 screens)
├── apps/admin/      React Vite + Cloudflare Pages/Workers/D1 — admin portal + Contract Studio
├── apps/keeper/     Cloudflare Worker (cron every 5 min) — price-target keeper
├── contracts/       Fresh StelixVault Solidity contract + Solana Anchor skeleton
└── README.md        This file
```

| Piece | Stack | Status |
|---|---|---|
| Mobile app | Expo SDK 58, TS, Expo Router, ethers v6, SecureStore | Built, typechecked (0 errors), 64/64 unit tests, web export verified, live at https://stelix-v2-web.pages.dev/. **Not yet tested on a phone, no EAS build yet.** |
| StelixVault | Solidity 0.8.24, Foundry 1.10.0 | Built, **21/21 Foundry tests pass**. No testnet or mainnet deploy yet. **No audit yet.** |
| Solana program | Anchor skeleton | Uncompiled skeleton, Jupiter CPI is a TODO stub. |
| Admin portal | React 18, Vite 5, TS, Cloudflare Pages/Workers/D1 | Built (`vite build` passes). **Not deployed live.** |
| Keeper | Cloudflare Worker, TS, vitest | **13/13 tests pass**. Live on-chain wiring is stubbed. |

## The Bull Lock

Unlock = **whichever comes first**: the unlock date you chose, **or** the price target you chose.

- At the date, tokens return to your wallet.
- At the price target, the set share is **auto-sold to USDT** (registry-driven exit stablecoin: USDT where listed, otherwise clearly labelled USDC — e.g. USDC on Arc/Base) and the USDT lands in your wallet.
- Profit ladder: sell in stages, e.g. 25% at 2x, 25% at 3x, 25% at 5x, remainder at the date.
- Trailing stop: after any target is hit, a fall of 10/15/20% from the peak auto-sells the remainder.
- Break modes (chosen at lock time): Immutable (no early break), Penalty Break (24h cooling-off, 5–10% penalty), Guardian Break (Phase 2, 48h + partner approval). **Penalty is waived when a price target or the maturity date triggers the exit.**
- Four exit protections on every auto-sell: 30-minute TWAP guard (a 1-minute wick cannot fire), price-impact guard (default 5%, split instead of dumping), minimum-receive (slippage 1.5% default), fail-safe retry (lock stays locked, keeper retries, manual unlock always available).

## Multichain — Arc as default

Chain registry is data, not code. Arc is the default chain, then BNB, Base, Ethereum, Polygon, and Solana (separate Anchor program, same UX/rules). Adding a chain is an admin workflow in Chain Manager, not an app rewrite. Every chain goes testnet first, then mainnet only after verification and a small-value smoke test. The app shows a Testnet badge whenever a testnet chain is selected.

## Demo vs live — read this first

- **Demo data is REMOVED.** `src/lib/demoData.ts` was deleted in the
  2026-11-26 live-data rebuild and the 2026-11-26 integration pass rewired
  every screen to the live types (`TokenBalance`, `TxRecord`,
  `LivePrice.price: number | null`). No `$1.36` balance, no `0xcca9…`
  wallet, no GTAN/PIEVERSE/MBTC/XGIRL sample tokens anywhere in the mobile
  app. A new wallet starts at $0.00 with 0 tokens, no locks and no history
  until real on-chain data exists; anything unavailable shows "—" or an
  empty state with the reason, never a sample number.
- **Live now:** real 12-word mnemonic wallet (ethers v6, PBKDF2 600k +
  AES-GCM, SecureStore / encrypted-localStorage fallback); live EVM balances
  via RPC + ERC-20 `balanceOf`; live prices/market data via CoinGecko,
  DexScreener and GeckoTerminal (verified 2026-11-26); live DexScreener
  search for Discover; token import by contract address; Change Password
  and Export Secrets (password re-entry required); history via Etherscan
  API v2 when `EXPO_PUBLIC_EXPLORER_API_KEY` is set (empty + "no-key"
  message without it); swap quotes via 1inch v6 (key-gated) and the
  PancakeSwap V2 router on BNB.
- **Still stubbed (labelled in-app, never faked):** send execution and swap
  execution (quotes/reviews work; no transaction is sent or recorded);
  vault locks (local plan records only — **vault contract addresses are
  `null` / not deployed yet**, so `createLockOnChain` refuses with the
  not-deployed message); multi-wallet (single wallet only); per-chain
  Solana address (one EVM address only); Solana balances/history
  (needs `@solana/web3.js`, not installed); GeckoTerminal trending
  (unverified endpoint — empty + error if it fails).
- **Keeper on-chain wiring is stubbed** (`fetchActiveLocks`, `fetchPricePoints`, `simulateSwap`, `executeTriggerOnChain` in `apps/keeper/src/`). The decision logic (TWAP, guards, trailing stop, retry) is implemented and tested; the RPC/indexer integration is pending.
- **Admin Contract Studio contract is the full `contracts/src/StelixVault.sol`** (synced in this repo). It is a starter, not audited.
- **Arc exit stablecoin:** registry-driven. Confirm USDT availability on Arc at build time, otherwise USDC labelled clearly in-app. No lock is created under a vague promise.

## How to run

### Prerequisites

Node 20+ (tested with Node 24), npm, Foundry (`forge`) for contracts, Wrangler 4.x for Cloudflare. No secrets in this repo — use env vars / Cloudflare secrets / Secure Vault only.

### Mobile app

```bash
cd apps/mobile
npm install
npm test          # Jest — vault logic + live-data layer, 64 tests (8 suites)
npx tsc --noEmit
npx expo export --platform web   # web export check (no EAS build yet)
npm start         # then scan the QR in Expo Go to test on a phone
```

Note: native-only modules (`expo-secure-store`, `expo-local-authentication`) are not bundled in Expo Go — the full unlock flow needs a dev build (`npx expo run:android` / EAS dev build). Jest install may need `--legacy-peer-deps` (react-dom peer conflict, see `apps/mobile/README.md`).

### Contracts (Foundry)

```bash
cd contracts
forge install     # installs forge-std (lib/ is not committed)
forge build       # solc 0.8.24, via_ir
forge test -vv    # 21 tests
```

Deploy scripts (testnet first, Arc first) are in `contracts/script/` — they need per-chain RPC, keeper, router and TWAP price-feed addresses via env vars. **Do not deploy to mainnet without an audit, testnet flow, and a small-value smoke lock.** See `contracts/README.md`.

### Admin portal

```bash
cd apps/admin
npm install
npx tsc --noEmit
npm run build     # Vite build; dist/ is the Pages output
npx wrangler pages deploy dist --project-name stelix-admin   # live deploy, owner only
```

Create the D1 database first and set `database_id` in `wrangler.toml`. Secrets via `wrangler secret put`. Cloudflare Access gates the portal to the owner only.

### Keeper

```bash
cd apps/keeper
npm install
npx tsc --noEmit
npm test          # vitest, 13 tests
npm run build     # tsc + wrangler deploy --dry-run
npx wrangler deploy   # live deploy, owner only
```

Cron runs every 5 minutes. See `apps/keeper/README.md` for the live-wiring TODOs.

## Test results (verified in this VM, 2026-11-26)

| Suite | Command | Result |
|---|---|---|
| Mobile vault logic + live-data layer | `npm test` in `apps/mobile` | **64 passed, 64 total (8 suites)** |
| Mobile typecheck | `npx tsc --noEmit` in `apps/mobile` | Clean, exit 0 (was 48 errors before the 2026-11-26 integration pass) |
| Mobile web export + live deploy | `npx expo export --platform web` + Wrangler Pages deploy | Exported `dist/` for all 18 screens; live at https://stelix-v2-web.pages.dev/ (root 200, main JS bundle 200) |
| Contracts | `forge test -vv` in `contracts` | **21 passed, 0 failed** |
| Admin typecheck + build | `npx tsc --noEmit && npm run build` in `apps/admin` | Clean, built in ~3s |
| Keeper tests | `npx vitest run` in `apps/keeper` | **13 passed, 13 total** |
| Keeper build | `npm run build` in `apps/keeper` | Exit 0, dry-run only |

## Design

Clean white background, dark navy `#0B1220` / `#0F172A` cards and buttons, mint green accent for gains and target-hit states, rounded cards, bottom tabs Home / Swap / Vault (centre) / Discover / History. Logo is the original Stelix mark (`apps/mobile/assets/icon.png`, `apps/admin/public/logo.png`, copied as-is, md5-verified). No emoji in UI, icons only. Animations: splash fade, screen transitions, animated countdown, chart animations, pull-to-refresh, button press states, skeleton loading.

## Still pending

- [ ] Test the mobile app on a real phone via Expo Go / dev build (user asked: install and test first, before EAS build)
- [ ] EAS build (explicitly **not** run yet)
- [ ] Testnet deploy of StelixVault per chain (Arc testnet first), full lock → target → auto-sell → USDT flow, explorer verification, registration in Chain Manager
- [ ] Keeper live wiring (D1/indexer lock feed, DEX TWAP/Chainlink prices, router swap simulation, keeper-key `executeTrigger` signing, backup runner)
- [ ] Independent audit of the exact compiled mainnet artifact
- [ ] Mainnet deploy (gated in Contract Studio: audit + testnet flow + smoke test + typed confirmation)
- [ ] Solana Anchor program: `anchor build`, devnet deploy and tests, Jupiter CPI
- [ ] Live Cloudflare deploy of admin + keeper (D1 creation, secrets, Cloudflare Access)
- [ ] Open decisions from the pitch (p.19): Arc exit stablecoin, default break mode, auto-sell fee %, audit provider/budget

## Security

Non-custodial: seed phrase is generated and stored only on-device, encrypted with a key derived from the app password, protected by the device keystore. A separate 6-digit Discipline PIN is required to create, break or change a lock. The admin can never move a user's locked funds. The StelixVault contract has no admin withdrawal function and is non-upgradeable by design.
