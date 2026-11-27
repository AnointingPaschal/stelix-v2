# Stelix 2.0 — Chain Scope: ALL chains (restored)

Date: 2026-11-27. Reversal (user, 2026-11-27): "work with all chains from
beginning" — the Arc + BNB scope-down of 2026-11-27 02:24 WAT is fully
reversed. All six chains are active again in the mobile wallet.

## Active chains

| Chain | Status | Notes |
|-------|--------|-------|
| Arc (testnet 5042002) | ACTIVE, default | USDC gas (6 decimals). Swaps refuse honestly — no DEX router verified on Arc testnet yet. Vault not deployed. |
| BNB Chain (56) | ACTIVE | Live balances/prices, PancakeSwap V2 swaps live. Vault not deployed. |
| Base (8453) | ACTIVE | Restored 2026-11-27. Swap catalogue, logo folder + token list, wrapped-native + CoinGecko entries, explorer chain id restored. No router confirmed (swaps refuse honestly without a 1inch key). Vault not deployed. |
| Ethereum (1) | ACTIVE | Restored 2026-11-27. Same as Base. |
| Polygon (137) | ACTIVE | Restored 2026-11-27. Same as Base. |
| Solana | ACTIVE | Restored 2026-11-27. `src/lib/solana.ts` restored from git history; `@solana/web3.js` and `ed25519-hd-key` reinstalled; Solana branches restored in balances, history, vault note, wallet (derived Solana address in wallet meta), address book (base58 validation), AppContext (`solanaAddress` + `chainAddress`), Receive (Solana address + QR), Send / Swap / vault create (honest Solana refusals where no Solana path is wired yet). SOL restored in price/logo maps. |

Arc MAINNET (`arc-mainnet`, chain id 5042) is a separate registry entry
and stays DISABLED (`active: false`) until a mainnet deployment is
explicitly approved — it is not one of the six active chains.

## What was restored (2026-11-27)

- `src/lib/chains.ts` — `active: true` on all six chains; `active` flag,
  `ACTIVE_CHAINS` and `isChainActive()` kept (they are the mechanism the
  admin Chain Manager will drive — see "How to add a chain" below).
- `src/lib/solana.ts` — restored from git history (HEAD 81ec9da).
- `package.json` / `package-lock.json` — `@solana/web3.js ^3.2.1`
  (SDK-compatible version resolved by `npx expo install`; HEAD had
  ^1.98.4) and `ed25519-hd-key ^2.0.0` reinstalled.
- `src/lib/balances.ts` — Solana balance branch (SOL + SPL), `SOL:
  'solana'` in `MAJOR_COINGECKO_IDS`.
- `src/lib/history.ts` — Solana history branch;
  `EXPLORER_CHAIN_IDS` for Ethereum 1, BNB 56, Base 8453, Polygon 137,
  Arc 5042002.
- `src/lib/swapTokens.ts` — catalogue rows for Base, Ethereum, Polygon,
  Solana (canonical contract/mint addresses from before the scope-down).
- `src/lib/discover.ts` — `DISCOVER_CHAINS` / `discoverNetworks` read
  `ACTIVE_CHAINS` (now all six); GeckoTerminal networks verified for
  bsc, eth, base, polygon_pos, solana and arc. The `isChainActive`
  filters are kept — they are a no-op while all chains are active and
  are the guard if a chain is disabled again.
- `src/lib/tokenLogos.ts` — Trust Wallet folders (`base`, `ethereum`,
  `polygon`, `solana`) + Uniswap token lists + native CoinGecko ids
  (ETH / SOL / POL).
- `src/lib/prices.ts` — wrapped natives (WETH, WETH on Base, WMATIC)
  + CoinGecko ids (ETH, WETH, SOL, POL).
- `src/lib/vault.ts` — Solana vault note restored ("Solana vault is an
  Anchor program — not wired yet.").
- `src/lib/wallet.ts` — Solana address derivation/storage
  (`solanaAddress` in wallet meta, `isValidSolanaAddress` re-export).
  The ExpoCrypto / secure-random work in this file was NOT touched.
- `src/lib/addressBook.ts` — EVM + Solana validation (`kind: 'evm' |
  'solana'`).
- `src/lib/swap.ts` — `ROUTER_ADDRESSES` for Base / Ethereum / Polygon
  restored as `null` (no router verified on those chains — never reuse
  another chain's router).
- `src/store/AppContext.tsx` — `solanaAddress` restored; `chainAddress`
  is the derived Solana address on Solana, the EVM address elsewhere,
  and is now also exposed through the store so Receive can show it.
- `src/components/ui.tsx` — network picker reads `ACTIVE_CHAINS`
  (now all six), Arc first (default).
- `src/app/receive.tsx`, `src/app/send.tsx`,
  `src/app/(tabs)/swap.tsx`, `src/app/vault/create.tsx`,
  `src/app/settings.tsx`, `src/app/(tabs)/discover.tsx` — Solana
  branches / refusals / labels restored as they were pre-scope-down.
  (`src/app/(tabs)/history.tsx` needed no change — its history comes
  from `lib/history.ts`, which was restored.)
- Tests — `src/lib/__tests__/solana.test.ts` restored from git history
  (6 tests); `chains`, `addressBook`, `discover`, `swap`,
  `swap-advanced` updated back to the all-chains scope, including a
  test that the active list is exactly all six chains.

## How to add a chain in future (from admin)

The wallet-side contract (the admin side is being built separately;
`src/lib/adminChains.ts` does not exist yet in the wallet):

1. **Admin (Chain Manager):** add the chain in the admin Chain
   Manager → it is stored in D1 (registry row: chain id, RPC,
   explorer, native asset, stablecoins, router/vault addresses,
   `active` flag). Only verified values — never reuse another chain's
   router, RPC or stablecoin address.
2. **Wallet fetch:** the wallet fetches the admin registry
   (`src/lib/adminChains.ts` merge — to be added with the admin work)
   and merges it over the built-in `CHAINS` registry in
   `src/lib/chains.ts`. The merge is keyed by chain id; an admin row
   can flip `active`, override an RPC/explorer, or add a brand-new
   chain. The `active` flag, `ACTIVE_CHAINS` and `isChainActive()` in
   `chains.ts` already exist for exactly this: every picker, token
   list, fetcher and Discover filter reads `ACTIVE_CHAINS`, never
   `CHAINS` directly.
3. **Fallback:** when offline or the admin API fails, the wallet falls
   back to the built-in `CHAINS` registry — the app must keep working
   with the six built-in chains and their verified RPCs/explorers.
4. **Per-chain data a new chain needs before it can go live** (same
   checklist as the 2026-11-27 restore): swap catalogue rows in
   `src/lib/swapTokens.ts`, Trust Wallet folder + token-list URL in
   `src/lib/tokenLogos.ts`, wrapped-native + CoinGecko ids in
   `src/lib/prices.ts` (and `MAJOR_COINGECKO_IDS` in
   `src/lib/balances.ts` if the native asset needs a CoinGecko price),
   Etherscan v2 chain id in `EXPLORER_CHAIN_IDS` in
   `src/lib/history.ts`, router in `ROUTER_ADDRESSES` in
   `src/lib/swap.ts` ONLY after verifying the router address on that
   chain, and a StelixVault address in `VAULT_ADDRESSES` in
   `src/lib/chains.ts` ONLY after a verified deploy. A non-EVM chain
   also needs its own lib module (like `src/lib/solana.ts`) plus
   branches in balances, history, vault, wallet, address book and the
   screens.
5. **Verify after any add:** `npx tsc --noEmit`, `npm test`,
   `npx expo-doctor`, then check the chain appears in the picker,
   balances load, and Discover shows its pairs.

## Files changed in the scope-down (2026-11-27) — all reversed

Same file list as the original scope-down note (see git history for
the scope-down diff): `chains.ts`, `solana.ts` (deleted, now
restored), `package.json` / `package-lock.json`, `balances.ts`,
`history.ts`, `swapTokens.ts`, `discover.ts`, `tokenLogos.ts`,
`prices.ts`, `vault.ts`, `wallet.ts`, `addressBook.ts`, `swap.ts`,
`AppContext.tsx`, `ui.tsx`, `receive.tsx`, `send.tsx`, `swap.tsx`,
`vault/create.tsx`, `settings.tsx`, `discover.tsx`, `history.tsx`,
and the `chains` / `addressBook` / `discover` / `swap` /
`swap-advanced` / `solana` tests.

## Packages kept (shared, not chain-specific)

- `ethers` — used by Arc, BNB, Base, Ethereum, Polygon (RPC, signing,
  ERC-20).
- `@noble/ciphers`, `@noble/hashes`, `expo-crypto` — wallet encryption
  / secure random (chain-agnostic).
- `@react-native-async-storage/async-storage` — kv storage.
- Navigation, charting (`react-native-svg`, `react-native-qrcode-svg`),
  `lucide-react-native`, Safe Area, SecureStore, biometrics — UI/platform,
  not chain-specific.

## Realtime admin sync + Maintenance Mode + admin network mode (2026-11-27)

- The wallet polls the admin live (GET /api/sync, every 45s while open, on
  foreground, on network-picker open, on pull-to-refresh, on manual Refresh).
  This is live polling, NOT true push. A monotonic `sync_state.version`
  bumps on every admin write, so edits land within one poll interval.
- Deleted chains are tombstoned (`deleted_chains` table); disabled chains
  stay disabled. Both are persisted on-device, so a deleted/disabled chain
  never resurrects from the built-in fallback even when the admin API is down.
- Maintenance Mode (admin page /maintenance, D1 `maintenance` table):
  scope `wallet` blocks signing with a banner; scope `all` shows a full
  maintenance screen with the admin's message. The admin portal itself is
  never blocked.
- Network mode (admin Chain Manager card, D1 `network_mode` table):
  `null` = all networks (default), `testnet` / `mainnet` filters the wallet
  to that mode's chains. The admin is the source of truth; the wallet's
  network picker cannot override it. A mode flip while a signing modal is
  open is deferred until the transaction flow finishes, then a
  "Switched to Mainnet/Testnet by admin" notice is shown.
- Safety guard, unchanged: switching mode does NOT deploy a vault, does NOT
  bypass the mainnet gate, and does NOT make locks/swaps live on mainnet.
  Arc Mainnet stays `active: false` in the built-in registry; it only
  appears in the wallet when the admin sets mode = mainnet AND the admin D1
  row for `arc-mainnet` is active. On any mainnet chain with no vault,
  locks/swaps still refuse honestly ("Vault not deployed on Mainnet yet").
  No vault is deployed on any chain; no independent audit exists.
