# Circle User-Controlled Wallets — Stelix 2.0 (Arc, hybrid)

Circle UCW (non-custodial MPC) alongside the existing self-custody
wallet. The self-custody wallet (seed phrase, BNB/Base/ETH/Polygon/
Solana) is untouched — Circle is an additional option for Arc only.

## What works, where

| Situation | Circle |
|---|---|
| Expo Go (incl. Termux phone testing) | **NOT available.** The Circle SDK is a native module Expo Go does not ship. The app still launches; Circle shows "Circle wallet needs the EAS build — not available in Expo Go" and is disabled. Nothing crashes. |
| Web build (`expo export --platform web`) | **NOT available.** Same disabled state. The SDK is only ever loaded by a dynamic import on native, so web export is unaffected. |
| EAS release APK / development build | Available **once** the App ID is set **and** the backend endpoints are live (below). |
| No Circle App ID yet / backend not live | Disabled with "Set up Circle in admin". No fake wallet, no fake balance. |

## What still needs doing (not done by the mobile integration)

1. **Circle App ID — DONE (2026-11-27).** The user supplied his exact
   App ID, `d15deb9f-8d3c-5c06-be01-de05897d30ea`, now the default in
   `src/lib/circle.ts` (`DEFAULT_CIRCLE_APP_ID`) and in `app.json`
   `expo.extra.circleAppId`. An App ID is a public identifier, not a
   secret. `EXPO_PUBLIC_CIRCLE_APP_ID` still overrides it when set. Do
   NOT invent any other App ID. (The Circle API key was also just
   updated — a separate worker is re-verifying it with
   `GET /v1/w3s/config/entity` and checking `data.appId` matches this
   App ID. The key itself is server-only and never appears here.)
2. **Backend endpoints on the admin Worker** (`https://stelix-admin.pages.dev`,
   being built in parallel — do NOT assume they exist):
   - `POST /api/circle/users` → `{ userId, userToken, encryptionKey }`
     (fresh `userToken` per session; the API key stays server-only)
   - `POST /api/circle/challenges` → `{ challengeId, type }`
     Types: `SET_PIN`, `CREATE_WALLET`, `TRANSFER`, `CONTRACT_EXECUTION`.
     The Worker calls Circle's server API with the API key.
   - `GET /api/circle/wallets[?userId=]` → `[{ id, address, blockchain, state, accountType }]`
   - `GET /api/circle/transactions/:id` → transaction status + `txHash`
   - `GET /api/circle/config` → `{ configured, appIdConfigured, blockchains }`
   Until these return 200, every mobile Circle call fails with the honest
   "Circle backend is not set up yet" message (a 404/501 is mapped to it).
3. **EAS build** — the release APK / dev build that actually contains the
   Circle native module. `npx expo prebuild` picks up the two Circle
   config plugins in `app.json` (`withCopyFiles`, `podfile-modifier`).
   Do NOT test Circle in Expo Go and expect it to work.

## Wallet model

- **EOA first** (cheaper, broad, gas is USDC on Arc). Arc **testnet**
  (`ARC-TESTNET`, chain 5042002) first.
- **SCA / Gas Station: not built yet.** Gas Station supports Arc
  Mainnet + Testnet when it lands; nothing in the app claims otherwise.
- **PIN / email OTP / social**: the Circle SDK UI handles PIN setup and
  per-transaction approval (`sdk.execute(userToken, encryptionKey,
  [challengeId])`). The app never sees or stores the PIN.
- **Session secrets**: `userToken` + `encryptionKey` live in memory only
  (`CircleWalletContext` ref/state). Only wallet id + address are
  persisted (kv `stelix.circle.wallets.v1`); balances are always read
  live from the Arc RPC.

## Files

- `src/lib/circle.ts` — config, Expo Go gating, lazy SDK loader,
  admin-Worker API client, challenge payload builders. No static
  import of the SDK or expo-constants anywhere in this file.
- `src/lib/circleVault.ts` — builds the approve + `createLock`
  contract-execution steps for StelixVault. Refuses honestly when no
  vault is deployed (today: always) or the chain is not Arc.
- `src/store/CircleWalletContext.tsx` — provider: status, user session,
  wallets, PIN setup, wallet creation, USDC send, vault lock.
- `src/app/circle.tsx` — Circle Arc wallet screen: status, create
  wallet, PIN setup, address + live USDC balance (Arc RPC), Send USDC.
- `src/app/onboarding.tsx` — wallet choice: "Arc — Circle wallet (no
  seed phrase)" vs "Self-custody wallet (seed phrase)".
- `src/app/vault/create.tsx` — when a Circle Arc wallet is active and
  the chain is Arc, the lock is signed via Circle challenges instead
  of the password modal. The existing vault-not-deployed refusal still
  runs first, so no Circle lock can be created until a vault exists.
- `src/app/_layout.tsx` — `CircleWalletProvider` under `AppProvider`;
  `circle` route registered.
- `app.json` — Circle config plugins + `extra.circleAppId` placeholder.

## Honest limits (do not remove these from the UI)

- Circle UCW alone **cannot auto-sell**: every transaction needs user
  approval in the Circle PIN UI. Auto-sell happens only in StelixVault
  via the keeper. Never claim Circle auto-sells.
- No vault is deployed anywhere yet, so **Vault Create Lock via Circle
  always refuses** ("Vault not deployed on Arc yet") until a vault
  address is registered in admin.
- The mobile app never calls `api.circle.com` and never holds the
  Circle API key.
