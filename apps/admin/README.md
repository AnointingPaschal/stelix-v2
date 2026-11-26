# Stelix 2.0 — Admin Portal

React Vite + TypeScript admin portal for Stelix 2.0, hosted on Cloudflare Pages, backed by Workers + D1 (see `wrangler.toml`, `migrations/0001_schema.sql`, `src/worker/index.ts`).

## Design
Navy `#0B1220` + white, mint-green accent `#2FD6A3`, matching the Stelix mobile app and the real Stelix logo (`public/logo.png`, copied as-is from the supplied PNG — not redrawn). No emoji, icons/text only.

## Pages (spec Part E)
Login (Cloudflare Access gate + admin credentials/passkey, no public registration) · Dashboard (TVL per chain, active locks, auto-sells, keeper health, alerts) · Contract Studio (edit StelixVault source, compile with pinned solc `0.8.24`, testnet deploy, verify, register, gated mainnet deploy) · Chain Manager (Arc default, then BNB, Base, Ethereum, Polygon, Solana; statuses testnet/live/paused/hidden) · Token/DEX Registry · Keeper Monitor (runs, triggers, swaps executed/retried/failed, balances, run-now/pause) · Fees and Limits · Announcements · App Config and Releases (signed config, feature flags, min version) · Support Lookup (wallet/lock ID/tx hash, public on-chain state only — never ask for a seed phrase or private key) · Audit Log and Settings.

## Contract
Starter `StelixVault` source lives in `src/contracts/StelixVault.sol` and is loaded into Contract Studio. It is a **starter** — full unit/fork tests and an independent audit are required before mainnet (spec Part F). Non-upgradeable by design; no admin withdrawal function; keeper can only call `executeTrigger()` and funds only ever go to the lock owner.

## Demo data
Until the Cloudflare deploy, pages show clearly labelled **DEMO** data via `src/lib/api.ts` stubs. Production reads D1 through the Workers API in `src/worker/index.ts`.

## Run locally
```bash
npm install
npm run build        # tsc --noEmit && vite build
npm run dev          # http://localhost:5173
```

## Deploy (NOT done in this local build — pending owner decision)
```bash
npx wrangler d1 create stelix-admin-db   # paste database_id into wrangler.toml
npx wrangler d1 execute stelix-admin-db --file=migrations/0001_schema.sql
npx wrangler pages deploy dist --project-name stelix-admin
```
Secrets via `wrangler secret put <NAME>` — never commit values. See `.dev.vars.example` (placeholders only).

## Pending
Live Cloudflare deploy, D1 creation, Cloudflare Access setup, real solc compile job (Worker/container), explorer verification wiring, independent contract audit, mainnet deploy.
