/**
 * LIVE transaction history — real explorer / RPC data for the actual
 * wallet address. No placeholder transactions, no sample history.
 * NEVER asks the user for a key: every path below works with no key
 * at all, and no shared/hardcoded API key is shipped in the app.
 *
 * Sources, in order, for EVM chains:
 *  1. Blockscout v2 API (keyless) — Arc Mainnet (its explorer IS
 *     Blockscout), Ethereum (eth.blockscout.com) and
 *     Base (base.blockscout.com). Token transfers AND native
 *     transactions from /api/v2/addresses/{addr}/. Verified live
 *     2026-11-28: eth.blockscout.com returned real token-transfers
 *     and transactions for a known-active address, no key.
 *  2. Etherscan-family APIs (BscScan / Etherscan / BaseScan /
 *     PolygonScan) — ONLY when a key is already set (bundled
 *     EXPO_PUBLIC_EXPLORER_API_KEY or a key saved on-device in
 *     Settings). Optional enhancement: fuller coverage, including
 *     native transfers. Never required, never requested.
 *  3. Public-RPC eth_getLogs scan (keyless) — ERC-20/BEP-20 Transfer
 *     events for the chain's known stablecoins (chain.stablecoins +
 *     exitStablecoinAddress), one call per block page with the token
 *     contracts as the address filter, walked backwards, decoded
 *     with symbol()/decimals() read on-chain. Honest limits: only
 *     token transfers for known contracts (native sends are invisible
 *     to logs), and only as far back as the page cap reaches; public
 *     nodes rate-limit this hard (bsc-dataseed refused even 10-block
 *     scans from the dev VM on 2026-11-28, so the page size halves
 *     on limit errors and the scan degrades to an error, never to
 *     invented data). Etherscan-family APIs WITHOUT a key were
 *     verified dead the same day (Missing/Invalid API Key on ETH /
 *     Polygon; "Free API access is not supported for this chain" on
 *     BNB / Base), and no public Blockscout exists for BNB or
 *     Polygon — so the log scan is the only keyless BNB/Polygon path.
 *
 * Restored 2026-11-27: all chains active again (Arc + BNB scope-down reversed).
 *
 * Dust/spam: zero-value transfers and unsolicited tokens are flagged
 * isSpam and hidden by default (filterHistory with showDust=false).
 */
import { getChain, type ChainConfig } from './chains';
import { fetchSolanaHistory } from './solana';
import { fetchDexScreenerToken } from './prices';
import { kvGet } from './storage';
import { listLocalTxs, type LocalTxRecord, type LocalTxType } from './localHistory';

export type TxKind = 'sent' | 'received' | 'swap' | 'lock' | 'unlock' | 'autosell' | 'break' | 'claim' | 'approve' | 'other';
export type TxStatus = 'confirmed' | 'pending' | 'failed' | 'unknown';

export interface TxRecord {
  id: string; // tx hash
  hash: string;
  kind: TxKind;
  token: string;
  amount: number; // token units (float, display only)
  amountRaw: string;
  usd: number | null; // null when no live price was available
  counterparty?: string;
  note?: string;
  at: number; // epoch ms
  status: TxStatus;
  isSpam: boolean;
  chainId: string;
  blockNumber: number | null;
}

export interface HistoryResult {
  chain: ChainConfig;
  address: string;
  txs: TxRecord[];
  status: 'ok' | 'error';
  error: string | null;
  updatedAt: number;
}

const EXPLORER_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bnb: 56,
  base: 8453,
  polygon: 137,
};

/** Chains whose explorer is Blockscout — its v2 API needs no key. */
const BLOCKSCOUT_CHAIN_IDS = new Set(['arc-mainnet']);

/** Public Blockscout v2 instances for non-Arc chains (keyless, no
 *  account). eth.blockscout.com verified live 2026-11-28 (real
 *  token-transfers + transactions, no key). base.blockscout.com
 *  exists but Cloudflare-challenges datacentre IPs (403 from the dev
 *  VM); it is tried best-effort and falls through to the RPC log
 *  scan when challenged. No public Blockscout exists for BNB or
 *  Polygon (bsc.blockscout.com 404, polygon.blockscout.com
 *  unreachable, both checked 2026-11-28). */
const BLOCKSCOUT_BASES: Record<string, string> = {
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
};

/** Blockscout v2 base for this chain, or null when no public
 *  Blockscout instance covers it. Arc chains use their own
 *  explorer URL (which IS Blockscout). */
function blockscoutBaseFor(chain: ChainConfig): string | null {
  if (BLOCKSCOUT_CHAIN_IDS.has(chain.id)) return chain.explorerUrl.replace(/\/$/, '');
  return BLOCKSCOUT_BASES[chain.id] ?? null;
}

/** Blockscout v2 address fields are { hash } objects (or a plain string). */
function bsAddress(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { hash?: unknown }).hash === 'string') {
    return (v as { hash: string }).hash;
  }
  return '';
}

interface BlockscoutTokenTransfer {
  block_number?: number;
  from?: unknown;
  to?: unknown;
  timestamp?: string;
  token?: { symbol?: string; decimals?: string | number; name?: string };
  total?: { value?: string };
  transaction_hash?: string;
}

interface BlockscoutTx {
  hash?: string;
  block_number?: number;
  from?: unknown;
  to?: unknown;
  value?: string;
  timestamp?: string;
  status?: string;
}

function mapBlockscoutTransfer(raw: BlockscoutTokenTransfer, chain: ChainConfig, address: string): TxRecord | null {
  const hash = raw.transaction_hash ?? '';
  const value = raw.total?.value ?? '0';
  const decimals = Number(raw.token?.decimals ?? 18);
  const amount = Number(value) / 10 ** decimals;
  if (!hash || !Number.isFinite(amount)) return null;
  const from = bsAddress(raw.from).toLowerCase();
  const me = address.toLowerCase();
  const kind: TxKind = from === me ? 'sent' : 'received';
  const rec: TxRecord = {
    id: `${hash}:${raw.token?.symbol ?? 'token'}`,
    hash,
    kind,
    token: raw.token?.symbol ?? chain.nativeSymbol,
    amount,
    amountRaw: value,
    usd: null,
    counterparty: kind === 'sent' ? bsAddress(raw.to) : bsAddress(raw.from),
    at: raw.timestamp ? Date.parse(raw.timestamp) : 0,
    status: 'confirmed',
    isSpam: false,
    chainId: chain.id,
    blockNumber: Number(raw.block_number) || null,
  };
  rec.isSpam = isDustOrSpam(rec);
  return rec;
}

function mapBlockscoutTx(raw: BlockscoutTx, chain: ChainConfig, address: string): TxRecord | null {
  const hash = raw.hash ?? '';
  const value = raw.value ?? '0';
  // Native value is always wei (18 decimals) — see EVM_NATIVE_RPC_DECIMALS.
  const amount = Number(value) / 10 ** 18;
  if (!hash || !Number.isFinite(amount) || amount === 0) return null;
  const from = bsAddress(raw.from).toLowerCase();
  const me = address.toLowerCase();
  const kind: TxKind = from === me ? 'sent' : 'received';
  const rec: TxRecord = {
    id: hash,
    hash,
    kind,
    token: chain.nativeSymbol,
    amount,
    amountRaw: value,
    usd: null,
    counterparty: kind === 'sent' ? bsAddress(raw.to) : bsAddress(raw.from),
    at: raw.timestamp ? Date.parse(raw.timestamp) : 0,
    status: raw.status === 'ok' ? 'confirmed' : 'failed',
    isSpam: false,
    chainId: chain.id,
    blockNumber: Number(raw.block_number) || null,
  };
  rec.isSpam = isDustOrSpam(rec);
  return rec;
}

/** Keyless Blockscout v2 history. Token transfers first, then
 *  native transactions; a tx that appears in both (Arc's native USDC
 *  is also its ERC-20 view) is kept once, as the token transfer. */
async function fetchBlockscoutHistory(chain: ChainConfig, address: string, baseUrl?: string): Promise<TxRecord[]> {
  const base = (baseUrl ?? chain.explorerUrl).replace(/\/$/, '');
  const [ttRes, txRes] = await Promise.all([
    fetchWithTimeout(`${base}/api/v2/addresses/${address}/token-transfers?type=ERC-20`),
    fetchWithTimeout(`${base}/api/v2/addresses/${address}/transactions`),
  ]);
  if (!ttRes.ok) throw new Error(`Blockscout token-transfers returned HTTP ${ttRes.status}.`);
  if (!txRes.ok) throw new Error(`Blockscout transactions returned HTTP ${txRes.status}.`);
  const ttJson = await ttRes.json();
  const txJson = await txRes.json();
  const out: TxRecord[] = [];
  const seen = new Set<string>();
  for (const item of (ttJson?.items ?? []) as BlockscoutTokenTransfer[]) {
    const rec = mapBlockscoutTransfer(item, chain, address);
    if (rec) {
      out.push(rec);
      seen.add(rec.hash);
    }
  }
  for (const item of (txJson?.items ?? []) as BlockscoutTx[]) {
    const rec = mapBlockscoutTx(item, chain, address);
    if (rec && !seen.has(rec.hash)) out.push(rec);
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

export function getExplorerApiKey(): string | null {
  const v =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>).EXPO_PUBLIC_EXPLORER_API_KEY
      : undefined;
  return v && v.length > 0 ? v : null;
}

/** On-device storage key for a user-saved Etherscan API key (Settings
 *  writes it, getExplorerApiKeyAsync reads it). The key never leaves
 *  the device and is never logged. */
export const EXPLORER_API_KEY_STORAGE_KEY = 'stelix_explorer_api_key_v1';

/** The explorer key, wherever it lives: the bundled
 *  EXPO_PUBLIC_EXPLORER_API_KEY wins, then a key saved on-device in
 *  Settings, then null. A stored key unlocks history on BNB, Base,
 *  Ethereum and Polygon without a rebuild. */
export async function getExplorerApiKeyAsync(): Promise<string | null> {
  const env = getExplorerApiKey();
  if (env) return env;
  try {
    const stored = await kvGet(EXPLORER_API_KEY_STORAGE_KEY);
    const trimmed = stored?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, ms = 10_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

interface ExplorerTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimal?: string;
  timeStamp: string;
  blockNumber: string;
  isError?: string;
  txreceipt_status?: string;
}

/** Dust/spam heuristic (labelled, not a security verdict):
 *  - zero-value transfer, or
 *  - token symbol that looks like an unsolicited airdrop (contains $,
 *    "FREE", "AIRDROP", a URL, or is empty) with no USD value.
 *  Real transfers of real tokens are never flagged by this alone. */
export function isDustOrSpam(tx: Pick<TxRecord, 'amount' | 'usd' | 'token'>): boolean {
  if (tx.amount === 0) return true;
  if (tx.usd !== null && tx.usd < 0.01 && /(\$|FREE|AIRDROP|http|www\.|\.com)/i.test(tx.token)) return true;
  if (/(\$|FREE|AIRDROP|http|www\.|\.com)/i.test(tx.token) && (tx.usd === null || tx.usd === 0)) return true;
  return false;
}

/** Hide dust/spam by default; showDust=true reveals them. */
export function filterHistory(txs: TxRecord[], opts?: { showDust?: boolean }): TxRecord[] {
  if (opts?.showDust) return txs;
  return txs.filter((t) => !t.isSpam);
}

/* ------------------------------------------------------------------ */
/* Local-ledger merge (Phase B).                                      */
/*                                                                    */
/* Transactions the app itself broadcast are recorded in the local    */
/* ledger (lib/localHistory.ts) at signing time, so History can show  */
/* them immediately — including pendings and native sends the         */
/* on-chain sources cannot see yet (or, on BNB/Polygon, at all).     */
/* The merge is: local records FIRST (newest first), then on-chain    */
/* rows, deduped by transaction hash (case-insensitive). A hash in    */
/* both sources appears ONCE, with the local record winning — it      */
/* carries the app-known type, amount and live status. On-chain       */
/* rows are still kept: they carry incoming transfers and any         */
/* pre-ledger history the local store never saw.                      */
/* ------------------------------------------------------------------ */

const LOCAL_KIND_MAP: Record<LocalTxType, TxKind> = {
  send: 'sent',
  swap: 'swap',
  lock: 'lock',
  unlock: 'unlock',
  break: 'break',
  claim: 'claim',
  approve: 'approve',
  other: 'other',
};

/** One local ledger record as a History row. Own transactions are
 *  never spam, and the counterparty is the destination address. */
export function localTxToTxRecord(local: LocalTxRecord): TxRecord {
  const amount = Number(local.amount);
  return {
    id: local.hash,
    hash: local.hash,
    kind: LOCAL_KIND_MAP[local.type] ?? 'other',
    token: local.tokenSymbol,
    amount: Number.isFinite(amount) ? amount : 0,
    amountRaw: local.amountRaw,
    usd: null,
    counterparty: local.to,
    at: local.timestamp,
    status: local.status,
    isSpam: false,
    chainId: local.chain,
    blockNumber: local.blockNumber,
  };
}

/** Local records first (newest first), then on-chain rows whose hash
 *  is not already covered by a local record. */
export function mergeHistoryTxs(local: LocalTxRecord[], onChain: TxRecord[]): TxRecord[] {
  const locals = [...local].sort((a, b) => b.timestamp - a.timestamp).map(localTxToTxRecord);
  const seen = new Set(locals.map((r) => r.hash.toLowerCase()));
  return [...locals, ...onChain.filter((t) => !seen.has(t.hash.toLowerCase()))];
}

/** Row-state label + tone for the History screen (and the tx detail
 *  pill). Confirmed rows show their date; pending / failed / unknown
 *  rows show this label instead, so a dropped tx never reads as
 *  pending forever. */
export type TxStatusTone = 'ok' | 'wait' | 'bad' | 'muted';

export function historyRowStatus(status: TxStatus): { label: string; tone: TxStatusTone } {
  switch (status) {
    case 'pending':
      return { label: 'Pending', tone: 'wait' };
    case 'failed':
      return { label: 'Failed', tone: 'bad' };
    case 'unknown':
      return { label: 'Unknown', tone: 'muted' };
    default:
      return { label: 'Confirmed', tone: 'ok' };
  }
}

function mapExplorerTx(raw: ExplorerTx, chain: ChainConfig, address: string): TxRecord {
  const decimals = Number(raw.tokenDecimal ?? 18);
  const amountRaw = raw.value ?? '0';
  const amount = Number(amountRaw) / 10 ** decimals;
  const from = (raw.from ?? '').toLowerCase();
  const me = address.toLowerCase();
  const kind: TxKind = from === me ? 'sent' : 'received';
  const failed = raw.isError === '1' || raw.txreceipt_status === '0';
  const rec: TxRecord = {
    id: raw.hash,
    hash: raw.hash,
    kind,
    token: raw.tokenSymbol ?? chain.nativeSymbol,
    amount: Number.isFinite(amount) ? amount : 0,
    amountRaw,
    usd: null, // priced by the caller/store when a live price exists
    counterparty: kind === 'sent' ? raw.to : raw.from,
    at: Number(raw.timeStamp) * 1000,
    status: failed ? 'failed' : 'confirmed',
    isSpam: false,
    chainId: chain.id,
    blockNumber: Number(raw.blockNumber) || null,
  };
  rec.isSpam = isDustOrSpam(rec);
  return rec;
}

/* ------------------------------------------------------------------ */
/* Keyless public-RPC Transfer-log scan (BNB / Polygon).   */
/*                                                                    */
/* One eth_getLogs call per block page, filtered to the chain's known */
/* stablecoin contracts, then filtered client-side to transfers      */
/* where the wallet is sender or receiver. Token symbol/decimals      */
/* come from on-chain eth_call; block times from eth_getBlockByNumber */
/* Public nodes rate-limit eth_getLogs hard, so the page size halves  */
/* on a limit error (2000 -> 100 blocks) instead of failing outright. */
/* ------------------------------------------------------------------ */

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const SYMBOL_SELECTOR = '0x95d89b41'; // symbol()
const DECIMALS_SELECTOR = '0x313ce567'; // decimals()

interface RpcLog {
  address: string;
  blockNumber: string;
  data: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
}

/** Single JSON-RPC call. Throws an Error whose message carries the
 *  node's error code (e.g. -32005 limit exceeded) when it fails. */
async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`RPC returned HTTP ${res.status}.`);
    const json = await res.json();
    if (json?.error) {
      const code = typeof json.error.code === 'number' ? json.error.code : '?';
      throw new Error(`RPC ${method} failed (${code}): ${json.error.message ?? 'unknown error'}`);
    }
    if (!('result' in (json ?? {}))) throw new Error(`RPC ${method} returned no result.`);
    return json.result;
  } finally {
    clearTimeout(t);
  }
}

function isRpcLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /-32005|-32011|limit exceeded|request limit/i.test(msg);
}

function hexToUtf8(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  let out = '';
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const code = parseInt(clean.slice(i, i + 2), 16);
    if (code === 0) continue;
    if (code < 0x80) out += String.fromCharCode(code);
  }
  return out;
}

/** Decode an ABI-encoded string return (dynamic string, or a bytes32
 *  symbol from older tokens). Returns null when undecodable. */
function decodeAbiString(hex: string): string | null {
  const clean = (hex.startsWith('0x') ? hex.slice(2) : hex).toLowerCase();
  if (clean.length < 64) return null;
  const offset = parseInt(clean.slice(0, 64), 16);
  if (offset === 32 && clean.length >= 128) {
    const len = parseInt(clean.slice(64, 128), 16);
    if (!Number.isFinite(len) || len <= 0 || len > 256) return null;
    return hexToUtf8(`0x${clean.slice(128, 128 + len * 2)}`) || null;
  }
  const asBytes32 = hexToUtf8(`0x${clean.slice(0, 64)}`).trim();
  return asBytes32 || null;
}

function decodeUint(hex: string): number | null {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!clean) return null;
  try {
    const n = Number(BigInt(`0x${clean}`));
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

interface TokenMeta {
  symbol: string;
  decimals: number;
}

/** symbol()/decimals() for one token contract, read on-chain.
 *  Falls back to DexScreener for the symbol and 18 decimals so one
 *  unreadable contract never kills the whole scan. */
async function fetchTokenMeta(chain: ChainConfig, tokenAddress: string): Promise<TokenMeta> {
  const fallbackSymbol = `${tokenAddress.slice(0, 6)}…${tokenAddress.slice(-4)}`;
  let symbol: string | null = null;
  let decimals: number | null = null;
  try {
    const [symRes, decRes] = await Promise.all([
      rpcCall(chain.rpcUrl, 'eth_call', [{ to: tokenAddress, data: SYMBOL_SELECTOR }, 'latest']),
      rpcCall(chain.rpcUrl, 'eth_call', [{ to: tokenAddress, data: DECIMALS_SELECTOR }, 'latest']),
    ]);
    symbol = typeof symRes === 'string' ? decodeAbiString(symRes) : null;
    decimals = typeof decRes === 'string' ? decodeUint(decRes) : null;
  } catch {
    // Fall through to the DexScreener fallback below.
  }
  if (!symbol) {
    try {
      const ds = await fetchDexScreenerToken(chain.id, tokenAddress);
      symbol = ds?.symbol ?? null;
    } catch {
      symbol = null;
    }
  }
  return { symbol: symbol ?? fallbackSymbol, decimals: decimals ?? 18 };
}

async function fetchBlockTimeMs(
  chain: ChainConfig,
  blockNumberHex: string,
  cache: Map<string, number>,
): Promise<number> {
  const cached = cache.get(blockNumberHex);
  if (cached !== undefined) return cached;
  try {
    const block = (await rpcCall(chain.rpcUrl, 'eth_getBlockByNumber', [blockNumberHex, false])) as {
      timestamp?: string;
    } | null;
    const ms = block?.timestamp ? parseInt(block.timestamp, 16) * 1000 : 0;
    cache.set(blockNumberHex, ms);
    return ms;
  } catch {
    cache.set(blockNumberHex, 0);
    return 0;
  }
}

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

/** Keyless token-transfer history from the public RPC: Transfer logs
 *  for the chain's known stablecoins, newest first. `tokenAddresses`
 *  overrides the chain's stablecoin list when the caller knows more
 *  contracts (e.g. the wallet's imported tokens). Only token
 *  transfers are visible this way — native coin sends leave no log.
 *  Throws when the RPC refuses log queries, so the caller can report
 *  the failure instead of showing an empty list as if it were fact. */
export async function fetchRpcLogHistory(
  chain: ChainConfig,
  address: string,
  opts?: { tokenAddresses?: string[]; maxTxs?: number },
): Promise<TxRecord[]> {
  const configured = [
    ...(opts?.tokenAddresses ?? []),
    ...Object.values(chain.stablecoins ?? {}),
    chain.exitStablecoinAddress,
  ];
  const tokens = [...new Set(configured.filter((a): a is string => !!a).map((a) => a.toLowerCase()))];
  if (tokens.length === 0) {
    throw new Error(`No known token contracts to scan for history on ${chain.name}.`);
  }
  const me = address.toLowerCase();
  const latestHex = (await rpcCall(chain.rpcUrl, 'eth_blockNumber', [])) as string;
  let toBlock = parseInt(latestHex, 16);
  if (!Number.isFinite(toBlock) || toBlock <= 0) throw new Error('RPC returned no latest block.');
  const maxTxs = opts?.maxTxs ?? 50;
  const out: TxRecord[] = [];
  const seen = new Set<string>();
  const metaCache = new Map<string, TokenMeta>();
  const timeCache = new Map<string, number>();
  let pageSize = 2000;
  let pages = 0;
  const MAX_PAGES = 60;
  while (out.length < maxTxs && pages < MAX_PAGES && toBlock > 0) {
    const fromBlock = Math.max(0, toBlock - pageSize + 1);
    let logs: RpcLog[];
    try {
      const res = (await rpcCall(chain.rpcUrl, 'eth_getLogs', [
        {
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
          address: tokens,
          topics: [TRANSFER_TOPIC],
        },
      ])) as RpcLog[];
      logs = Array.isArray(res) ? res : [];
    } catch (e) {
      if (isRpcLimitError(e) && pageSize > 100) {
        pageSize = Math.max(100, Math.floor(pageSize / 2));
        continue;
      }
      throw e;
    }
    pages += 1;
    for (const log of logs) {
      if (!log || !Array.isArray(log.topics) || log.topics.length < 3) continue;
      const from = topicAddress(log.topics[1]);
      const to = topicAddress(log.topics[2]);
      if (from !== me && to !== me) continue;
      const dedupeKey = `${log.transactionHash}:${log.logIndex}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const tokenAddress = (log.address ?? '').toLowerCase();
      let meta = metaCache.get(tokenAddress);
      if (!meta) {
        meta = await fetchTokenMeta(chain, tokenAddress);
        metaCache.set(tokenAddress, meta);
      }
      let value = 0n;
      try {
        value = BigInt(log.data ?? '0x0');
      } catch {
        value = 0n;
      }
      const amount = Number(value) / 10 ** meta.decimals;
      if (!Number.isFinite(amount)) continue;
      const at = await fetchBlockTimeMs(chain, log.blockNumber, timeCache);
      const kind: TxKind = from === me ? 'sent' : 'received';
      const rec: TxRecord = {
        id: dedupeKey,
        hash: log.transactionHash,
        kind,
        token: meta.symbol,
        amount,
        amountRaw: value.toString(),
        usd: null,
        counterparty: kind === 'sent' ? to : from,
        at,
        status: 'confirmed',
        isSpam: false,
        chainId: chain.id,
        blockNumber: parseInt(log.blockNumber, 16) || null,
      };
      rec.isSpam = isDustOrSpam(rec);
      out.push(rec);
      if (out.length >= maxTxs) break;
    }
    toBlock = fromBlock - 1;
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

export async function fetchHistory(
  chainId: string,
  address: string,
  opts?: { page?: number; offset?: number; tokenAddresses?: string[] },
): Promise<HistoryResult> {
  const chain = getChain(chainId);
  const startedAt = Date.now();
  // Local ledger for this wallet+chain (Phase B merge): a failed read
  // never blocks on-chain history — it just means no local rows.
  let local: LocalTxRecord[] = [];
  try {
    local = await listLocalTxs(address, chain.id);
  } catch {
    local = [];
  }
  if (chain.kind === 'solana') {
    // Solana history comes from the RPC itself (getSignaturesForAddress +
    // getParsedTransaction) — no explorer API key needed. An EVM address
    // is meaningless here; the caller passes the derived Solana address.
    try {
      const solTxs = await fetchSolanaHistory(address);
      const symbolCache = new Map<string, string>();
      const txs: TxRecord[] = [];
      for (const st of solTxs) {
        if (st.solChange !== 0) {
          const sent = st.solChange < 0;
          txs.push({
            id: st.signature,
            hash: st.signature,
            kind: sent ? 'sent' : 'received',
            token: chain.nativeSymbol,
            amount: Math.abs(st.solChange),
            amountRaw: String(Math.round(Math.abs(st.solChange) * 1e9)),
            usd: null,
            at: st.blockTime !== null ? st.blockTime * 1000 : st.slot,
            status: st.failed ? 'failed' : 'confirmed',
            isSpam: false,
            chainId: chain.id,
            blockNumber: st.slot,
          });
        }
        for (const tc of st.tokenChanges) {
          let symbol = symbolCache.get(tc.mint);
          if (!symbol) {
            const ds = await fetchDexScreenerToken(chain.id, tc.mint);
            symbol = ds?.symbol ?? `${tc.mint.slice(0, 4)}…${tc.mint.slice(-4)}`;
            symbolCache.set(tc.mint, symbol);
          }
          txs.push({
            id: `${st.signature}:${tc.mint}`,
            hash: st.signature,
            kind: tc.change < 0 ? 'sent' : 'received',
            token: symbol,
            amount: Math.abs(tc.change),
            amountRaw: String(Math.round(Math.abs(tc.change) * 10 ** tc.decimals)),
            usd: null,
            at: st.blockTime !== null ? st.blockTime * 1000 : st.slot,
            status: st.failed ? 'failed' : 'confirmed',
            isSpam: false,
            chainId: chain.id,
            blockNumber: st.slot,
          });
        }
      }
      txs.sort((a, b) => b.at - a.at);
      return { chain, address, txs: mergeHistoryTxs(local, txs), status: 'ok', error: null, updatedAt: Date.now() };
    } catch (e) {
      return {
        chain,
        address,
        txs: mergeHistoryTxs(local, []),
        status: local.length > 0 ? 'ok' : 'error',
        error:
          local.length > 0
            ? null
            : `Could not read Solana history from ${chain.rpcUrl}: ${e instanceof Error ? e.message : String(e)}`,
        updatedAt: startedAt,
      };
    }
  }
  // Keyless first, always: Blockscout v2 where a public instance
  // exists (Arc, Ethereum, Base), then — only if a key is already
  // set — the Etherscan-family APIs, then the keyless public-RPC
  // Transfer-log scan. No step asks the user for anything, and no
  // key is ever required: with no key at all the Blockscout and
  // log-scan paths still return real transactions.
  let lastError: string | null = null;
  const bsBase = blockscoutBaseFor(chain);
  if (bsBase) {
    try {
      const txs = await fetchBlockscoutHistory(chain, address, bsBase);
      return { chain, address, txs: mergeHistoryTxs(local, txs), status: 'ok', error: null, updatedAt: Date.now() };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  const apiKey = await getExplorerApiKeyAsync();
  if (apiKey) {
    const chainIdNum = EXPLORER_CHAIN_IDS[chain.id];
    const page = opts?.page ?? 1;
    const offset = opts?.offset ?? 50;
    // Etherscan API v2 (documented multi-chain endpoint), per-chain base as fallback.
    const urls = chainIdNum
      ? [
          `https://api.etherscan.io/v2/api?chainid=${chainIdNum}&module=account&action=tokentx&address=${address}&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`,
          `https://api.etherscan.io/v2/api?chainid=${chainIdNum}&module=account&action=txlist&address=${address}&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`,
        ]
      : [];
    if (chain.explorerApiUrl) {
      urls.push(
        `${chain.explorerApiUrl}?module=account&action=tokentx&address=${address}&page=${page}&offset=${offset}&sort=desc&apikey=${apiKey}`,
      );
    }
    for (const url of urls) {
      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          lastError = `Explorer API returned HTTP ${res.status}.`;
          continue;
        }
        const json = await res.json();
        if (json?.status !== '1' || !Array.isArray(json?.result)) {
          lastError = typeof json?.message === 'string' ? json.message : 'Explorer API returned no transactions.';
          continue;
        }
        const txs = (json.result as ExplorerTx[])
          .map((r) => mapExplorerTx(r, chain, address))
          .sort((a, b) => b.at - a.at);
        return { chain, address, txs: mergeHistoryTxs(local, txs), status: 'ok', error: null, updatedAt: Date.now() };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  // Keyless fallback: Transfer logs from the public RPC. Token
  // transfers only, for the chain's known stablecoins (or the
  // caller's tokenAddresses) — never invented, never key-gated.
  try {
    const txs = await fetchRpcLogHistory(chain, address, { tokenAddresses: opts?.tokenAddresses });
    return { chain, address, txs: mergeHistoryTxs(local, txs), status: 'ok', error: null, updatedAt: Date.now() };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
  }
  // Every on-chain source failed: the local ledger still shows the
  // wallet's own transactions (including pendings) instead of an
  // empty list. With no local rows either, report the error.
  if (local.length > 0) {
    return {
      chain,
      address,
      txs: mergeHistoryTxs(local, []),
      status: 'ok',
      error: null,
      updatedAt: startedAt,
    };
  }
  return {
    chain,
    address,
    txs: [],
    status: 'error',
    error: `Could not load transaction history on ${chain.name} right now (${lastError ?? 'history source unavailable'}). Pull to refresh to try again.`,
    updatedAt: startedAt,
  };
}
