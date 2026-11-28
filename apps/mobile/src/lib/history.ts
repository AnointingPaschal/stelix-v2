/**
 * LIVE transaction history — real explorer / RPC data for the actual
 * wallet address. No placeholder transactions, no sample history.
 *
 * Two sources, in order:
 *  1. Blockscout v2 API (keyless) — used for Arc Testnet + Arc Mainnet,
 *     whose explorers ARE Blockscout (explorer.testnet.arc.io /
 *     explorer.arc.io). No API key exists or is needed: token transfers
 *     AND native transactions are read from /api/v2/addresses/{addr}/.
 *     This is what makes History work out of the box on Arc — the
 *     user's 30 USDC receive showed as "No explorer API key" before
 *     this, because the old code only knew the Etherscan path.
 *  2. Etherscan-family explorer APIs (BscScan / Etherscan / BaseScan /
 *     PolygonScan) for the other EVM chains. They need an API key —
 *     the bundled EXPO_PUBLIC_EXPLORER_API_KEY, or a free key saved
 *     on-device in Settings (getExplorerApiKeyAsync). Without a key the
 *     function returns an empty list with status 'no-key' and a clear
 *     message, NOT invented transactions. Etherscan API v2
 *     (`api.etherscan.io/v2/api?chainid=...`) is the documented
 *     multi-chain endpoint; per-chain api.<chain>.com bases are kept
 *     as fallback.
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

export type TxKind = 'sent' | 'received' | 'swap' | 'lock' | 'unlock' | 'autosell' | 'other';
export type TxStatus = 'confirmed' | 'pending' | 'failed';

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
  status: 'ok' | 'no-key' | 'error';
  error: string | null;
  updatedAt: number;
}

const EXPLORER_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bnb: 56,
  base: 8453,
  polygon: 137,
  arc: 5042002,
};

/** Chains whose explorer is Blockscout — its v2 API needs no key. */
const BLOCKSCOUT_CHAIN_IDS = new Set(['arc', 'arc-mainnet']);

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

/** Keyless Blockscout v2 history for Arc. Token transfers first, then
 *  native transactions; a tx that appears in both (Arc's native USDC
 *  is also its ERC-20 view) is kept once, as the token transfer. */
async function fetchBlockscoutHistory(chain: ChainConfig, address: string): Promise<TxRecord[]> {
  const base = chain.explorerUrl.replace(/\/$/, '');
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

/** True when an error string is the "no explorer key" failure from
 *  fetchHistory — the History screen uses this to show the friendly
 *  "add a key in Settings" hint instead of the bare error text. */
export function isNoExplorerKeyError(error: string | null): boolean {
  return !!error && error.startsWith('No explorer API key');
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

export async function fetchHistory(
  chainId: string,
  address: string,
  opts?: { page?: number; offset?: number },
): Promise<HistoryResult> {
  const chain = getChain(chainId);
  const startedAt = Date.now();
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
      return { chain, address, txs, status: 'ok', error: null, updatedAt: Date.now() };
    } catch (e) {
      return {
        chain,
        address,
        txs: [],
        status: 'error',
        error: `Could not read Solana history from ${chain.rpcUrl}: ${e instanceof Error ? e.message : String(e)}`,
        updatedAt: startedAt,
      };
    }
  }
  // Arc runs on Blockscout — keyless, so History works with no key at all.
  let lastBlockscoutError: string | null = null;
  if (BLOCKSCOUT_CHAIN_IDS.has(chain.id)) {
    try {
      const txs = await fetchBlockscoutHistory(chain, address);
      return { chain, address, txs, status: 'ok', error: null, updatedAt: Date.now() };
    } catch (e) {
      lastBlockscoutError = e instanceof Error ? e.message : String(e);
      // Fall through: if an explorer key is set, the Etherscan path
      // below is tried next. Otherwise the Blockscout error is reported.
    }
  }
  const apiKey = await getExplorerApiKeyAsync();
  if (!apiKey) {
    return {
      chain,
      address,
      txs: [],
      status: lastBlockscoutError ? 'error' : 'no-key',
      error:
        lastBlockscoutError ??
        `No explorer API key configured. Add a free Etherscan API key in Settings to unlock transaction history on ${chain.name} — no sample transactions are shown.`,
      updatedAt: startedAt,
    };
  }
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
  let lastError: string | null = null;
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
      return { chain, address, txs, status: 'ok', error: null, updatedAt: Date.now() };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { chain, address, txs: [], status: 'error', error: lastError ?? 'Explorer API request failed.', updatedAt: startedAt };
}
