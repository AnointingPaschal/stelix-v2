# Stelix 2.0 — Mobile App (LIVE data layer)

Non-custodial multichain crypto vault wallet. **Lock it. Hold it. Exit on your plan.**
Built with React Native, Expo SDK 58, TypeScript and Expo Router.

> **LIVE build (lib/store).** Balances, prices, locks and history come from
> real RPC / API reads. There is no demo data anywhere in `src/lib/` or
> `src/store/` — `src/lib/demoData.ts` was deleted. A new wallet starts at
> $0.00 with 0 tokens and no locks/history until real on-chain data exists.
> Where a live source is unavailable the app shows an empty state with a
> clear reason, never a sample number. Stelix never guarantees profit.
> Crypto prices can fall as well as rise.

## What it is

- **Bull Lock** — unlock on the earlier of a date **or** a price target
  (30-minute TWAP must hold above target, so a one-minute wick cannot fire
  the exit). On target hit, the due share auto-sells to the chain's exit
  stablecoin (registry-driven: USDT where listed, USDC on Arc/Base — always
  labelled exactly in-app).
- Profit ladder, trailing stop, break modes (Immutable / Penalty / Guardian —
  penalty waived when a target or the date triggers), price-impact guard,
  minimum-receive, fail-safe retry.
- Multichain from day one: **Arc (default, testnet)** · BNB · Base · Ethereum ·
  Polygon · Solana (separate Anchor program, same UX).

## Live-data wiring (per source)

| Area | Live source | Endpoint / method | Status |
|---|---|---|---|
| Wallet | ethers v6 on-device | `Wallet.createRandom()` (real 12-word mnemonic), `Wallet.fromPhrase` / private key import | Live. Secret stored PBKDF2-HMAC-SHA-256 (600k iters) + AES-GCM, in `expo-secure-store` on native; on web the *encrypted* payload falls back to localStorage (labelled fallback, never plaintext). Wrong password throws — never accepted. |
| Chains | Registry `src/lib/chains.ts` | Arc testnet **5042002**, RPC `https://rpc.testnet.arc.network`, explorer `https://testnet.arcscan.app`; BNB 56, Base 8453, ETH 1, Polygon 137, Solana `https://api.mainnet-beta.solana.com` | Live. Arc mainnet (5042) is NOT enabled — testnet-first until a mainnet deploy is approved. Arc's native USDC exit-stablecoin address is marked to-confirm on ArcScan before mainnet use. |
| Balances | `src/lib/balances.ts` | `JsonRpcProvider.getBalance` + ERC-20 `balanceOf` (minimal ABI) per chain; imported-token list stored locally, empty by default | Live for EVM. **Solana balances NOT wired** — needs `@solana/web3.js`, not installed; returns a clear error, not a fake balance. |
| Prices (majors) | CoinGecko, no key | `https://api.coingecko.com/api/v3/simple/price` | Live — verified 2026-11-26 (BNB $552.51). |
| Prices / market data | DexScreener, no key | `https://api.dexscreener.com/latest/dex/tokens/<address>`, `/latest/dex/search?q=<query>` | Live — verified 2026-11-26 (WBNB $552.90). |
| Prices fallback / candles | GeckoTerminal, no key | `https://api.geckoterminal.com/api/v2/networks/<network>/tokens/<address>` and `.../pools/<pool>/ohlcv/<timeframe>` | Live token lookup verified 2026-11-26. OHLCV endpoint is the documented GeckoTerminal shape; EMA7/EMA25/RSI(14) are computed from real candles only, otherwise "—". |
| Safety Score | `computeSafetyScore` in `prices.ts` | Liquidity, volume, market cap, honeypot flag, holder share, mint authority — only when the API actually returns them | Live inputs only. Missing data → **"Insufficient data"**, never a fake score. No honeypot/holder API is wired yet, so those inputs report "unavailable". |
| History | Explorer APIs | Etherscan API v2 `https://api.etherscan.io/v2/api?chainid=...&module=account&action=tokentx` (+ per-chain bases) | Live **only with a key** — see env vars. Without one: empty list + "no-key" message. Dust/spam hidden by default (`showDust` toggle in the store). Solana history not wired. |
| Discover | DexScreener search + GeckoTerminal trending | `https://api.dexscreener.com/latest/dex/search?q=...` (verified live) ; `https://api.geckoterminal.com/api/v2/networks/trending_pools` (**unverified** — returns empty + error if it fails) | Search live. Trending is best-effort/unverified — see `src/lib/discover.ts`. |
| Swap | 1inch v6 quote, then PancakeSwap router quote (BNB) | `https://api.1inch.dev/swap/v6.0/<chain>/quote` ; PancakeSwap V2 router `0x10ED43C718714eb63d5aA57B78B54704E256024E` `getAmountsOut` | Quote only. **Execution is NOT wired** — `executeSwap()` throws `SwapExecutionNotWiredError`. A real swap must be a signed wallet transaction; never simulated. |
| Vault (on-chain) | `src/lib/vault.ts` + `contracts/src/StelixVault.sol` | `createLock`, `claimMatured`, `claimTriggeredStage`, `requestBreak`/`executeBreak`, `getLock`, `getUserLocks` | **Not deployed on any chain yet** — `VAULT_ADDRESSES` are all null. `createLockOnChain` refuses with "Not deployed on this chain yet — testnet deploy required"; `getUserLocksOnChain` returns an empty list with that note. Pure Bull Lock engine (TWAP, ladder, trailing stop, break penalty) is fully implemented and tested. |
| Keeper / auto-sell execution | — | `pokePrice` / `executeTrigger` are keeper-only contract calls | Not wired in the app. Manual `claimTriggeredStage` is the fallback path. |

## Environment variables (all read from `process.env` / `EXPO_PUBLIC_*` only — no keys hardcoded)

| Variable | Needed for | Notes |
|---|---|---|
| `EXPO_PUBLIC_EXPLORER_API_KEY` | Transaction history (Etherscan-family APIs) | One Etherscan API key works across chains via API v2 (`chainid=`). Without it history is empty with a "no-key" message. |
| `EXPO_PUBLIC_ONEINCH_API_KEY` | Swap quotes via 1inch v6 | Without it, 1inch is skipped; BNB still quotes via PancakeSwap router, other chains return a clear no-quote error. |
| `EXPO_PUBLIC_ARC_RPC_URL` / `EXPO_PUBLIC_BNB_RPC_URL` / `EXPO_PUBLIC_BASE_RPC_URL` / `EXPO_PUBLIC_ETHEREUM_RPC_URL` / `EXPO_PUBLIC_POLYGON_RPC_URL` / `EXPO_PUBLIC_SOLANA_RPC_URL` | Override a chain's public RPC | Optional. Defaults are the public RPCs in `src/lib/chains.ts`. |
| (none) | CoinGecko, DexScreener, GeckoTerminal, PancakeSwap router quote | No key needed. |

Set them in `.env` (Expo loads `EXPO_PUBLIC_*` into the app) or in the
EAS / Cloudflare Pages build environment. Never commit a key.

## The 18 screens (spec Part D)

| # | Screen | File |
|---|---|---|
| 1 | Splash | `src/app/index.tsx` |
| 2 | Welcome / Onboarding | `src/app/onboarding.tsx` |
| 3 | Create Wallet | `src/app/create.tsx` |
| 4 | Import Wallet | `src/app/import.tsx` |
| 5 | Unlock | `src/app/unlock.tsx` |
| 6 | Home / Portfolio | `src/app/(tabs)/index.tsx` |
| 7 | Token Detail | `src/app/token/[symbol].tsx` |
| 8 | Send | `src/app/send.tsx` |
| 9 | Receive | `src/app/receive.tsx` |
| 10 | Swap | `src/app/(tabs)/swap.tsx` |
| 11 | Discover | `src/app/(tabs)/discover.tsx` |
| 12 | Vault Hub | `src/app/(tabs)/vault.tsx` |
| 13 | Create Lock (4 steps) | `src/app/vault/create.tsx` |
| 14 | Lock Detail | `src/app/vault/[id].tsx` |
| 15 | History | `src/app/(tabs)/history.tsx` |
| 16 | Notifications | `src/app/notifications.tsx` |
| 17 | Settings / Advanced | `src/app/settings.tsx` |
| 18 | Discipline Report | `src/app/discipline.tsx` |

Bottom tabs: Home / Swap / **Vault (centre)** / Discover / History.
Settings is reached from the Home header.

> **Integration complete (2026-11-26):** all screens in `src/app/` and
> `src/components/` are rewired to the live types (`TokenBalance`,
> `TxRecord`, `AppNotification[]`, `DisciplineStats`,
> `LivePrice.price: number | null`, `PriceSource`,
> `useLivePrice(symbol, { chainId, address, coingeckoId })`).
> `npx tsc --noEmit` is **0 errors** and `npm test` is **64/64 passing
> (8 suites)**. Wired in integration: token import (Home → `resolveTokenMetadata`
> + `addImportedToken` + balance refresh), Change Password and Export Secrets
> (Settings → `changePassword` / `exportSecret` in `src/lib/wallet.ts`,
> password re-entry required), Discover (live DexScreener search +
> GeckoTerminal trending), Token Detail (live price, market data, real
> candles, EMA/RSI, Safety Score from real inputs only). Still honestly
> stubbed: **send execution** (review works, no signed transfer is sent or
> recorded), **swap execution** (live quotes only, `executeSwap()` throws),
> **vault locks** (local plan records only until StelixVault is deployed),
> **multi-wallet** (single wallet — the sheet shows Wallet 1 only),
> **per-chain Solana address** (the wallet exposes one EVM address; the
> Receive screen warns that Solana uses base58 format), **Solana
> balances/history** (needs `@solana/web3.js`, not installed).

## Core logic

- `src/lib/vault.ts` — pure Bull Lock engine (TWAP, ladder, trailing stop,
  break penalty, impact guard, min-receive, retry backoff, review sentence)
  + live on-chain layer (`createLockOnChain`, `getUserLocksOnChain`,
  `claimMaturedOnChain`, `claimTriggeredStageOnChain`, `requestBreakOnChain`,
  `executeBreakOnChain`) against the exact `StelixVault` ABI.
- `src/lib/chains.ts` — chain + exit-stablecoin + StelixVault address registry (Arc default, testnet).
- `src/lib/wallet.ts` — ethers v6 non-custodial wallet, PBKDF2/AES-GCM encrypted in Expo SecureStore (encrypted localStorage fallback on web). No keys in code.
- `src/lib/crypto.ts` — the PBKDF2/AES-GCM encrypt/decrypt primitives (pure, tested).
- `src/lib/prices.ts` — DexScreener / CoinGecko / GeckoTerminal live prices, candles, EMA/RSI, safety score.
- `src/lib/balances.ts` — live RPC native + ERC-20 balances; imported-token list (empty by default).
- `src/lib/history.ts` — live explorer history, dust/spam filter (`showDust`).
- `src/lib/discover.ts` — live DexScreener search + GeckoTerminal trending.
- `src/lib/swap.ts` — live 1inch / PancakeSwap quotes only; execution not wired.
- `src/lib/storage.ts` — non-secret local key/value storage (web localStorage, in-memory elsewhere).
- `src/store/AppContext.tsx` — live app state (wallet, balances, locks, history, loading/error states).

## Run it

```bash
npm install
npm start          # Expo dev server — scan the QR with Expo Go
npm run web        # web preview
npm run android    # Android (Expo Go / dev build)
npm run ios        # iOS (macOS only)
```

> Note: `expo-secure-store` and `expo-local-authentication` are native
> modules not bundled in Expo Go. On native, use a development build
> (`npx expo run:android` / `eas build --profile development`) for the
> full unlock flow; the web export works with the encrypted-localStorage
> fallback.

## Verify it

```bash
npm test           # Jest unit tests for the vault engine + live-data layer (64 tests, 8 suites)
npm run typecheck  # tsc --noEmit — 0 errors
npm run export     # expo export --platform web (proves the bundle builds)
```

Live web build: https://stelix-v2-web.pages.dev/ (Cloudflare Pages project
`stelix-v2-web`, redeployed on every integration pass from a fresh `dist/`).

## Design

Clean white background, dark navy `#0B1220` / `#0F172A` cards and buttons,
mint green `#10B981` accent for gains / target-hit, rounded cards, icons
only (lucide) — no emoji in UI. Logo: the real Stelix mark from
`~/workspace/user/media_library/image/Stelix.png`, copied as-is into
`assets/` and used on splash and the home header.

## Still pending (not in this build)

- Send execution wiring (signed wallet transfer, audited) — review works,
  nothing is sent or recorded until then.
- StelixVault contract deployment (testnet-first, Arc first) + registration
  in `VAULT_ADDRESSES` — until then locks refuse with the not-deployed message.
- Keeper service for price-triggered auto-sells (the app's manual
  triggered-stage unlock is the fallback path).
- Swap execution wiring (signed wallet transaction, audited).
- Solana balances/history via `@solana/web3.js`; Solana Anchor vault program.
- Production `IPriceFeed` TWAP adapter per chain; honeypot/holder APIs for
  the safety score (currently "unavailable" inputs).
- EAS build / store submission — intentionally not run here.
