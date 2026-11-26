# Stelix 2.0 — Admin Portal

React Vite + TypeScript admin portal for Stelix 2.0, hosted on Cloudflare Pages, backed by Workers + D1 (see `wrangler.toml`, `migrations/0001_schema.sql`, `src/worker/index.ts`).

## Design
Navy `#0B1220` + white, mint-green accent `#2FD6A3`, matching the Stelix mobile app and the real Stelix logo (`public/logo.png`, copied as-is from the supplied PNG — not redrawn). No emoji, clean line icons only (lucide-react).

Mobile-first (redesigned 2026-11-26): under 1024px the sidebar is replaced by a sticky navy top bar + slide-in drawer + bottom nav; content is full-width, single-column, 16px padding, and wide tables become stacked cards. Desktop keeps a proper sidebar (collapsible to icons). Live vs demo data is shown with small Live / Demo pills, not a banner.

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

## Deploy (LIVE since 2026-11-26)
Production: https://stelix-admin.pages.dev/ — Cloudflare Pages project `stelix-admin` (branch `main`), D1 database `stelix-admin-db` (`598cd9fd-a29b-4286-b99d-f51c534d0308`), migrations `0001_schema.sql` + `0002_seed.sql` applied (chains seeded: Arc default/testnet, BNB/Base/Ethereum/Polygon/Solana hidden).
```bash
npm run build        # tsc + vite + esbuild src/worker/index.ts -> dist/_worker.js (Pages advanced mode)
npx wrangler pages deploy --project-name stelix-admin --branch main
npx wrangler d1 execute stelix-admin-db --remote --file=migrations/0001_schema.sql
npx wrangler d1 execute stelix-admin-db --remote --file=migrations/0002_seed.sql
```
Auth: owner-only server-side login (no Cloudflare Access — Access is not enabled on the account; the Access API returns `access.api.error.not_enabled`). Admin email `ozoemenapaschal09@gmail.com`, PBKDF2-SHA256 password hash and HMAC session secret are Pages secrets (`ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` — set via `wrangler pages secret put`, never committed). 5 failed attempts lock an IP for 15 minutes; every login is written to `audit_log`.
Live endpoints: `GET /api/chains`, `GET /api/keeper/runs`, `GET /api/admin/audit` (session required); `GET /api/health`, `GET /api/config` (public). Dashboard, tokens, fees, announcements and config pages still show labelled DEMO data until wired.
