# Stelix 2.0 — Admin Portal

React Vite + TypeScript admin portal for Stelix 2.0, hosted on Cloudflare Pages, backed by Workers + D1 (see `wrangler.toml`, `migrations/`, `src/worker/index.ts`).

**No sample data.** Every page reads live data — D1 rows and on-chain RPC reads. Empty tables render real empty states ("No locks yet", "No keeper runs yet"), never invented figures. There is no `demo.ts` and no fallback to placeholder data anywhere in `src/`.

## Design
Navy `#0B1220` + white, mint-green accent `#2FD6A3`, matching the Stelix mobile app and the real Stelix logo (`public/logo.png`, copied as-is from the supplied PNG — not redrawn). No emoji, clean line icons only (lucide-react).

Mobile-first (redesigned 2026-11-26): under 1024px the sidebar is replaced by a sticky navy top bar + slide-in drawer + bottom nav; content is full-width, single-column, 16px padding, and wide tables become stacked cards. Desktop keeps a proper sidebar (collapsible to icons). Live data is shown with small Live pills.

## Pages
Login (owner-only, server-side PBKDF2 login) · Dashboard (live TVL from on-chain vault balances, active locks, auto-sells, keeper health from the last real keeper run) · Contract Studio (edit StelixVault source, compile with pinned solc `0.8.24`, testnet deploy preparation, explorer verification, registration in Chain Manager, gated mainnet deploy) · Contract Audit (automated static audit of the exact source + independent-audit record + mainnet-gate status) · Chain Manager (Arc default, then BNB, Base, Ethereum, Polygon, Solana; statuses testnet/live/paused/hidden; add/edit chains) · Token/DEX Registry (live DexScreener search, add/remove in D1) · Keeper Monitor (real runs from D1, balances from RPC, Run Now / Pause) · Fees and Limits (versioned fee config in D1 with history) · Announcements (publish to D1, served live to the mobile app banner feed) · App Config and Releases (HMAC-signed config, feature flags, min version) · Support Lookup (wallet/lock ID/tx hash resolved from D1 + on-chain RPC, public state only — never ask for a seed phrase or private key) · Audit Log and Settings (audit log + backup export).

## Contract
`StelixVault` source lives in `src/contracts/StelixVault.sol` (exact mirror of `contracts/src/StelixVault.sol`, plus `src/contracts/interfaces/`). It is compiled for real by `scripts/compile.mjs` with pinned solc `0.8.24` (optimizer on, 200 runs, via IR) — see `src/contracts/StelixVault.artifact.json` (bytecode hash, deployed size, source hashes). Contract Studio only registers an address after the Worker verifies on-chain code (`eth_getCode`) and explorer source status, and after the submitted source hash matches the compiled artifact. Non-upgradeable by design; no admin withdrawal function; keeper can only call `executeTrigger()` and funds only ever go to the lock owner.

## Contract Audit module
`src/lib/auditCheck.ts` is a thorough built-in static checker (Slither is not installed in this VM) that runs on the exact StelixVault source: tx.origin, selfdestruct/delegatecall/callcode, admin drain functions, reentrancy guards on fund-moving functions, unchecked low-level calls, unchecked ERC-20 transfers (including multi-line `require(...)` forms), fee cap, slippage cap, single price-feed trust, pragma pinning, zero-address checks, approve-reset pattern, unbounded ladder loops, access control, checks-effects-interactions order, owner-powers inventory. Runs are stored in D1 (`audit_runs`) with timestamp, compiler, source hash and findings; each finding has severity, file/line, description, recommendation and fix status. **An automated audit is NOT a substitute for an independent human audit** — the page says so, and no independent audit is claimed: `external_audits` is empty until a real report is recorded with evidence. The mainnet gate passes only on a passing automated audit (zero open critical/high) OR a recorded passing independent audit — plus a verified testnet deployment and a smoke-test attestation, enforced server-side in the Worker.

## Run locally
```bash
npm install
npm run compile:contract   # real solc 0.8.24 compile -> src/contracts/StelixVault.artifact.json
npm test                   # vitest: audit checker + validation + Worker endpoints (fake D1)
npm run typecheck:worker   # tsc for src/worker + src/lib
npm run build              # tsc --noEmit && vite build && esbuild worker -> dist/_worker.js
npm run dev                # http://localhost:5173
```

## Deploy (coordinator only — do not deploy from a workstream agent)
Production: https://stelix-admin.pages.dev/ — Cloudflare Pages project `stelix-admin`, D1 database `stelix-admin-db` (`598cd9fd-a29b-4286-b99d-f51c534d0308`).
```bash
npx wrangler d1 execute stelix-admin-db --remote --file=migrations/0003_live.sql   # new tables (locks, auto_sells, fee_versions, keeper_state, compile_jobs, audit_runs, external_audits, gate_attestations)
npm run build
npx wrangler pages deploy dist --project-name stelix-admin
```
Secrets (set via `wrangler pages secret put <NAME> --project-name stelix-admin`, never committed):
- `ADMIN_PASSWORD_HASH` (pbkdf2-sha256$iterations$salt$key), `ADMIN_SESSION_SECRET` — login (already set).
- `CONFIG_SIGNING_SECRET` — **new, required** before any signed config can be published; the publish endpoint refuses (503) without it.
- `KEEPER_WORKER_URL`, `KEEPER_RUN_KEY` — **new, optional**; until the keeper Worker is live and these are set, Run Now honestly reports "keeper not live yet" and records nothing.
- `EXPLORER_API_KEY` — optional; without it, explorer source verification still works for most Etherscan-compatible APIs but may be rate-limited.
- No deployer private key is ever stored in the admin. Testnet deploys are broadcast by the Foundry flow (`contracts/script/`) with a testnet-only key; the admin only registers verified addresses.

Auth: owner-only server-side login. Admin email `ozoemenapaschal09@gmail.com`. 5 failed attempts lock an IP for 15 minutes; every login is written to `audit_log`.

## Live endpoints (all under `src/worker/index.ts`, session required unless noted)
- `GET /api/health`, `GET /api/config` (public, signed), `GET /api/announcements` (public, active banner feed)
- `GET /api/admin/dashboard` — TVL (on-chain), locks, auto-sells, keeper health
- `GET /api/chains` · `POST /api/admin/chains` · `POST /api/admin/chains/:id`
- `GET/POST/DELETE /api/admin/tokens` · `GET /api/admin/tokens/search` (DexScreener, live)
- `GET/POST /api/admin/fees` · `GET /api/admin/fees/history`
- `GET/POST/DELETE /api/admin/announcements`
- `GET/POST /api/admin/config`
- `GET /api/admin/locks` · `GET /api/support` (wallet / lock ID / tx hash)
- `GET /api/keeper/runs` · `GET /api/admin/keeper/status` · `POST /api/admin/keeper/run-now` · `POST /api/admin/keeper/pause`
- `POST /api/admin/compile` · `GET /api/admin/compile/latest` · `POST /api/admin/deploy/prepare|verify|register` · `GET /api/admin/deployments` · `POST /api/admin/deploy/gate/attest`
- `POST /api/admin/audit/run` · `GET/PATCH /api/admin/audit/runs[/:id]` · `GET/POST/DELETE /api/admin/audit/external` · `GET /api/admin/audit/gate`
- `GET /api/admin/audit` (log) · `GET /api/admin/backup`
