# Stelix 2.0 — Mobile App (DEMO)

Non-custodial multichain crypto vault wallet. **Lock it. Hold it. Exit on your plan.**
Built with React Native, Expo SDK 58, TypeScript and Expo Router.

> **DEMO build.** All balances, locks, prices and transactions are clearly
> labelled DEMO sample data. Live prices are fetched from CoinGecko /
> DexScreener where possible with graceful offline fallback. Vault contracts
> are not deployed yet — testnet-first from the admin Contract Studio.
> Stelix never guarantees profit. Crypto prices can fall as well as rise.

## What it is

- **Bull Lock** — unlock on the earlier of a date **or** a price target
  (30-minute TWAP must hold above target, so a one-minute wick cannot fire
  the exit). On target hit, the due share auto-sells to the chain's exit
  stablecoin (registry-driven: USDT where listed, USDC on Arc/Base — always
  labelled exactly in-app).
- Profit ladder, trailing stop, break modes (Immutable / Penalty / Guardian —
  penalty waived when a target or the date triggers), price-impact guard,
  minimum-receive, fail-safe retry.
- Multichain from day one: **Arc (default)** · BNB · Base · Ethereum ·
  Polygon · Solana (separate Anchor program, same UX).

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

## Core logic

- `src/lib/vault.ts` — pure Bull Lock engine (TWAP, ladder, trailing stop,
  break penalty, impact guard, min-receive, retry backoff, review sentence).
- `src/lib/chains.ts` — chain + exit-stablecoin registry (Arc default).
- `src/lib/wallet.ts` — ethers v6 non-custodial wallet, encrypted in
  Expo SecureStore. No keys in code; demo wallets are generated at runtime.
- `src/lib/prices.ts` — DexScreener / CoinGecko live-price hooks + fallback.
- `src/lib/demoData.ts` — v1-style demo tokens, locks, history, notifications.
- `src/store/AppContext.tsx` — demo app state (wallet, locks, settings).

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
> full unlock flow; the web export and demo flows work without them.

## Verify it

```bash
npm test           # Jest unit tests for the vault engine
npm run typecheck  # tsc --noEmit
npm run export     # expo export --platform web (proves the bundle builds)
```

## Design

Clean white background, dark navy `#0B1220` / `#0F172A` cards and buttons,
mint green `#10B981` accent for gains / target-hit, rounded cards, icons
only (lucide) — no emoji in UI. Logo: the real Stelix mark from
`~/workspace/user/media_library/image/Stelix.png`, copied as-is into
`assets/` and used on splash and the home header.

## Still pending (not in this build)

- StelixVault contract + admin Contract Studio deployment (separate work).
- Keeper service for price-triggered auto-sells (the app's manual
  triggered-stage unlock is the fallback path).
- Real RPC / indexer wiring — balances and locks are demo data for now.
- EAS build / store submission — intentionally not run here.
