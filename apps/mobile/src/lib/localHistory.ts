/**
 * LOCAL transaction history ledger — transactions the app itself
 * signs and broadcasts, recorded at signing time.
 *
 * Why this exists: the on-chain history sources (Blockscout v2,
 * public-RPC Transfer-log scan — see lib/history.ts) cannot see a
 * fresh transaction until it is indexed, cannot see native sends on
 * BNB/Polygon at all, and cannot see a pending transaction. This
 * module records every tx the app broadcasts the moment it is signed,
 * tracks its status by polling the chain's public RPC for a receipt,
 * and lets History merge these records with the on-chain sources
 * (deduped by hash — see Phase B).
 *
 * Storage: the app's existing kv pattern (lib/storage.ts — AsyncStorage
 * on native, localStorage on web, in-memory map in Jest). One JSON
 * array per wallet+chain, newest first, capped at 200 records per
 * scope so storage stays bounded; older records are pruned on write.
 * A small index key lists every scope that holds records, so the
 * poller can find pending txs across wallets/chains without
 * enumerating storage.
 *
 * Silent-app rule: nothing here is user-facing — no strings from this
 * module are ever shown in the UI.
 *
 * No seed phrase, private key or password is ever stored here — only
 * public transaction fields (hash, addresses, amounts).
 */

import { getChain } from './chains';
import { kvDelete, kvGet, kvSet } from './storage';

export type LocalTxType =
  | 'send'
  | 'swap'
  | 'lock'
  | 'unlock'
  | 'break'
  | 'claim'
  | 'approve'
  | 'other';

export type LocalTxStatus = 'pending' | 'confirmed' | 'failed' | 'unknown';

export interface LocalTxRecord {
  /** Transaction hash (lowercased). The dedupe key for History merging. */
  hash: string;
  /** Chain id/key as in lib/chains.ts (e.g. 'arc', 'bnb', 'arc-mainnet'). */
  chain: string;
  /** Wallet (EVM) address that signed, lowercased. */
  wallet: string;
  type: LocalTxType;
  /** Token symbol for display, e.g. 'USDC'. Native coin uses the chain's native symbol. */
  tokenSymbol: string;
  /** Token contract address, or null for the native coin. */
  tokenAddress: string | null;
  /** Human-readable amount, e.g. '30.5'. */
  amount: string;
  /** Raw amount in the token's smallest unit, as a decimal string. */
  amountRaw: string;
  from: string;
  to: string;
  /** Epoch ms when the app broadcast the transaction. */
  timestamp: number;
  status: LocalTxStatus;
  /** Block number once a receipt exists, otherwise null. */
  blockNumber: number | null;
}

/** Fields the signing site supplies when recording a broadcast tx.
 *  `status`/`blockNumber` default to 'pending'/null — a caller only
 *  passes them when it already knows the outcome. */
export type NewLocalTx = Omit<LocalTxRecord, 'status' | 'blockNumber' | 'hash' | 'wallet' | 'chain'> & {
  hash: string;
  chain: string;
  wallet: string;
  status?: LocalTxStatus;
  blockNumber?: number | null;
};

/** Newest 200 records kept per wallet+chain; older ones are pruned on write. */
export const LOCAL_HISTORY_MAX_PER_SCOPE = 200;

/**
 * A pending record with no receipt after this long is treated as
 * dropped (never mined / replaced) and marked `unknown` — pending
 * forever is worse than an honest "unknown". 24h covers even a slow
 * chain and a phone that was offline overnight; the record stays
 * visible in History with its unknown status, it is not deleted.
 */
export const LOCAL_TX_DROPPED_AFTER_MS = 24 * 60 * 60 * 1000;

const KEY_PREFIX = 'stelix_local_history_v1';
const INDEX_KEY = `${KEY_PREFIX}_index`;

interface Scope {
  wallet: string;
  chain: string;
}

function scopeKey(wallet: string, chain: string): string {
  return `${KEY_PREFIX}:${wallet.toLowerCase()}:${chain}`;
}

function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

function normalizeHash(hash: string): string {
  return hash.toLowerCase();
}

async function readScopeIndex(): Promise<Scope[]> {
  try {
    const raw = await kvGet(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Scope =>
        !!s && typeof s === 'object' && typeof (s as Scope).wallet === 'string' && typeof (s as Scope).chain === 'string',
    );
  } catch {
    return [];
  }
}

async function writeScopeIndex(scopes: Scope[]): Promise<void> {
  await kvSet(INDEX_KEY, JSON.stringify(scopes));
}

async function addScopeToIndex(wallet: string, chain: string): Promise<void> {
  const scopes = await readScopeIndex();
  const w = normalizeAddress(wallet);
  if (!scopes.some((s) => normalizeAddress(s.wallet) === w && s.chain === chain)) {
    scopes.push({ wallet: w, chain });
    await writeScopeIndex(scopes);
  }
}

function parseRecords(raw: string | null): LocalTxRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is LocalTxRecord =>
        !!r && typeof r === 'object' && typeof (r as LocalTxRecord).hash === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Record a transaction the moment the app signs/broadcasts it.
 * Same hash in the same scope replaces the old record (re-broadcast
 * / re-record is an update, never a duplicate). Newest first, capped
 * at LOCAL_HISTORY_MAX_PER_SCOPE — older records are pruned on write.
 */
export async function recordLocalTx(tx: NewLocalTx): Promise<LocalTxRecord> {
  const wallet = normalizeAddress(tx.wallet);
  const hash = normalizeHash(tx.hash);
  const record: LocalTxRecord = {
    ...tx,
    hash,
    wallet,
    tokenAddress: tx.tokenAddress ?? null,
    status: tx.status ?? 'pending',
    blockNumber: tx.blockNumber ?? null,
  };
  const key = scopeKey(wallet, tx.chain);
  const existing = parseRecords(await kvGet(key));
  const rest = existing.filter((r) => normalizeHash(r.hash) !== hash);
  const next = [record, ...rest].slice(0, LOCAL_HISTORY_MAX_PER_SCOPE);
  await kvSet(key, JSON.stringify(next));
  await addScopeToIndex(wallet, tx.chain);
  return record;
}

/**
 * Record a broadcast transaction from a signing site, never throwing.
 * Recording must never break the underlying send/swap/lock flow, so a
 * storage failure is swallowed here — the tx still happened on-chain
 * and the on-chain history sources can still find it once indexed.
 * Call only AFTER the transaction has actually been broadcast (a hash
 * was returned); a tx that fails to broadcast must never be recorded.
 */
export async function recordBroadcastTx(tx: NewLocalTx): Promise<void> {
  try {
    await recordLocalTx(tx);
  } catch {
    // Deliberately silent: recording is best-effort, the action is not.
  }
}

/** All local records for one wallet+chain, newest first. */
export async function listLocalTxs(wallet: string, chain: string): Promise<LocalTxRecord[]> {
  return parseRecords(await kvGet(scopeKey(wallet, chain)));
}

/** Every pending record across all wallets/chains that have local history. */
export async function listAllPendingLocalTxs(): Promise<LocalTxRecord[]> {
  const scopes = await readScopeIndex();
  const out: LocalTxRecord[] = [];
  for (const s of scopes) {
    const txs = await listLocalTxs(s.wallet, s.chain);
    for (const tx of txs) {
      if (tx.status === 'pending') out.push(tx);
    }
  }
  return out;
}

/**
 * Update one record's status (and block number when known).
 * Returns the updated record, or null when no record with that hash
 * exists in the scope.
 */
export async function updateLocalTxStatus(
  wallet: string,
  chain: string,
  hash: string,
  status: LocalTxStatus,
  blockNumber?: number | null,
): Promise<LocalTxRecord | null> {
  const key = scopeKey(wallet, chain);
  const txs = parseRecords(await kvGet(key));
  const target = normalizeHash(hash);
  let updated: LocalTxRecord | null = null;
  const next = txs.map((r) => {
    if (normalizeHash(r.hash) !== target) return r;
    updated = {
      ...r,
      status,
      blockNumber: blockNumber === undefined ? r.blockNumber : blockNumber,
    };
    return updated;
  });
  if (!updated) return null;
  await kvSet(key, JSON.stringify(next));
  return updated;
}

/**
 * Enforce the per-scope cap (and drop nothing else). Returns the
 * records kept, newest first. Called on every write by recordLocalTx;
 * exposed so a caller can re-prune after an import or a manual edit.
 */
export async function pruneLocalTxs(
  wallet: string,
  chain: string,
  max: number = LOCAL_HISTORY_MAX_PER_SCOPE,
): Promise<LocalTxRecord[]> {
  const key = scopeKey(wallet, chain);
  const txs = parseRecords(await kvGet(key));
  if (txs.length <= max) return txs;
  const kept = txs.slice(0, max);
  await kvSet(key, JSON.stringify(kept));
  return kept;
}

/**
 * Remove every local-history record and the scope index. Used by
 * tests (shared in-memory store) and by a full local-data wipe.
 * The wallet secret is untouched — this only clears history records.
 */
export async function clearAllLocalHistory(): Promise<void> {
  const scopes = await readScopeIndex();
  for (const s of scopes) {
    await kvDelete(scopeKey(s.wallet, s.chain));
  }
  await kvDelete(INDEX_KEY);
}

/* ------------------------------------------------------------------ */
/* Receipt poller — keyless, public RPC only.                         */
/*                                                                    */
/* One eth_getTransactionReceipt per pending record, against the     */
/* chain's public RPC (no explorer key, ever). A receipt with        */
/* status 0x1 confirms, 0x0 fails. No receipt yet: leave pending    */
/* unless the record is older than LOCAL_TX_DROPPED_AFTER_MS, in     */
/* which case it is marked `unknown` (dropped / replaced). A         */
/* failed RPC call leaves the record pending — the next poll retries.*/
/* Non-EVM chains (Solana, Pi) have no eth_getTransactionReceipt:   */
/* their pending records are only ever aged out to `unknown`.       */
/* ------------------------------------------------------------------ */

export interface PollPendingResult {
  checked: number;
  confirmed: number;
  failed: number;
  unknown: number;
  stillPending: number;
  errors: number;
}

interface RpcReceipt {
  status?: string;
  blockNumber?: string;
}

async function fetchReceipt(
  rpcUrl: string,
  hash: string,
  fetchImpl: typeof fetch,
): Promise<RpcReceipt | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [hash] }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: RpcReceipt | null; error?: unknown };
    if (json?.error) return null;
    return json?.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * One poll pass over every pending local record: confirm/fail from
 * the receipt, age out stale pendings to `unknown`. Cheap by design:
 * with no pending records it does zero network calls. `fetchImpl`
 * and `now` exist so tests can inject a fake RPC and a fixed clock.
 */
export async function pollPendingLocalTxs(opts?: {
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<PollPendingResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const now = opts?.now ?? Date.now();
  const result: PollPendingResult = {
    checked: 0,
    confirmed: 0,
    failed: 0,
    unknown: 0,
    stillPending: 0,
    errors: 0,
  };
  const pending = await listAllPendingLocalTxs();
  for (const tx of pending) {
    result.checked += 1;
    // Dropped / replaced: no receipt after the window — stop polling it.
    if (now - tx.timestamp > LOCAL_TX_DROPPED_AFTER_MS) {
      await updateLocalTxStatus(tx.wallet, tx.chain, tx.hash, 'unknown');
      result.unknown += 1;
      continue;
    }
    const chain = getChain(tx.chain);
    if (chain.kind !== 'evm' || !chain.rpcUrl) {
      // No EVM receipt to poll (Solana / Pi) — stays pending until aged out.
      result.stillPending += 1;
      continue;
    }
    let receipt: RpcReceipt | null;
    try {
      receipt = await fetchReceipt(chain.rpcUrl, tx.hash, fetchImpl);
    } catch {
      receipt = null;
      result.errors += 1;
    }
    if (receipt === null) {
      // No receipt yet (not mined) or the RPC call failed — retry next pass.
      result.stillPending += 1;
      continue;
    }
    const blockNumber = receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : null;
    if (receipt.status === '0x1') {
      await updateLocalTxStatus(tx.wallet, tx.chain, tx.hash, 'confirmed', Number.isFinite(blockNumber) ? blockNumber : null);
      result.confirmed += 1;
    } else if (receipt.status === '0x0') {
      await updateLocalTxStatus(tx.wallet, tx.chain, tx.hash, 'failed', Number.isFinite(blockNumber) ? blockNumber : null);
      result.failed += 1;
    } else {
      // Receipt without a status field (unusual) — leave pending, retry next pass.
      result.stillPending += 1;
    }
  }
  return result;
}

/**
 * App-open polling loop: one pass immediately (this is the launch
 * backfill — pending records left from a previous session are picked
 * up), then a pass every `intervalMs` while the app stays open.
 * Each pass is a no-op (zero network calls) when nothing is pending.
 * Returns a stop function; call it when the app unmounts.
 */
export function startLocalHistoryPolling(intervalMs: number = 30_000): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const pass = () => {
    if (stopped) return;
    void pollPendingLocalTxs().catch(() => {
      // A poll pass never throws (per-record errors are counted), but
      // never let a background timer crash the app either.
    });
  };
  // Launch backfill first, then the interval.
  pass();
  timer = setInterval(pass, intervalMs);
  return () => {
    stopped = true;
    if (timer !== null) clearInterval(timer);
  };
}
