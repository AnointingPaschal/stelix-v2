/**
 * LIVE transaction history — real explorer / RPC data for the actual
 * wallet address. No placeholder transactions, no sample history.
 *
 * Source: Etherscan-family explorer APIs (BscScan / Etherscan / BaseScan /
 * PolygonScan / ArcScan). They need an API key — read ONLY from
 * EXPO_PUBLIC_EXPLORER_API_KEY (see README). Without a key the function
 * returns an empty list with status 'no-key' and a clear message, NOT
 * invented transactions. Etherscan API v2 (`api.etherscan.io/v2/api?
 * chainid=...`) is the documented multi-chain endpoint; per-chain
 * api.<chain>.com bases are kept as fallback.
 *
 * Dust/spam: zero-value transfers and unsolicited tokens are flagged
 * isSpam and hidden by default (filterHistory with showDust=false).
 */
import { getChain, type ChainConfig } from './chains';
import { fetchSolanaHistory } from './solana';
import { fetchDexScreenerToken } from './prices';

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

export function getExplorerApiKey(): string | null {
  const v =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>).EXPO_PUBLIC_EXPLORER_API_KEY
      : undefined;
  return v && v.length > 0 ? v : null;
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
            // blockTime is null for unconfirmed / very old signatures:
            // 0 means "unknown date" (the screen renders "—"), never
            // the slot number, which would display as 01/01/1970.
            at: st.blockTime !== null ? st.blockTime * 1000 : 0,
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
            // blockTime null => unknown date (0), never the slot number.
            at: st.blockTime !== null ? st.blockTime * 1000 : 0,
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
  const apiKey = getExplorerApiKey();
  if (!apiKey) {
    return {
      chain,
      address,
      txs: [],
      status: 'no-key',
      error:
        'No explorer API key configured (EXPO_PUBLIC_EXPLORER_API_KEY). History is empty until a key is set — no sample transactions are shown.',
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
