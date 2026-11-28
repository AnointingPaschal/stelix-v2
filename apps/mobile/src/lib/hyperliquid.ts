/** DORMANT — the Trade tab was removed on 2026-11-28 (Discover restored).
 *  This client and src/lib/trade.ts are kept in place, with their tests,
 *  until Trade returns. Do not remove the @nktkas/hyperliquid dependency.
 */
/**
 * Hyperliquid client for the Stelix wallet.
 *
 * Built on the `@nktkas/hyperliquid` TypeScript SDK (v0.33.3, verified
 * working against the Hyperliquid testnet on 2026-11-28 — see the notes
 * at the bottom of this file). The SDK is runtime-agnostic: its only
 * dependencies are `@nktkas/rews` (a `WebSocket` wrapper), `@noble/hashes`,
 * `decimal.js` and `valibot` — no Node-only modules, no viem — so it
 * imports cleanly in React Native / Hermes and in jest.
 *
 * Rules this client follows:
 * - It NEVER holds a private key. Every trading action is EIP-712 signed
 *   through a signer supplied by the caller (the app's ethers v6 wallet,
 *   decrypted for one action by the signing modal). The signer is used
 *   for exactly one call and never stored.
 * - Default environment is TESTNET. Mainnet is opt-in per client.
 * - App leverage cap is 20x (`MAX_LEVERAGE`), enforced here even though
 *   Hyperliquid allows up to 50x on some markets.
 * - Errors are typed and user-friendly — never raw JSON to the UI.
 *
 * Funding notes (verified 2026-11-28):
 * - Mainnet deposit: send native Arbitrum USDC to the Bridge2 contract.
 *   Minimum 5 USDC — smaller deposits are NOT credited. The legacy
 *   bridge is deprecated in favour of Circle CCTP but still works.
 * - Testnet: claim 1,000 mock USDC at the drip. The faucet only pays
 *   addresses that have deposited on mainnet at least once.
 */

import * as hl from '@nktkas/hyperliquid';
import { ethers } from 'ethers';

export type HyperliquidEnv = 'mainnet' | 'testnet';

/** App-wide leverage cap for Hyperliquid perps (Hyperliquid allows up to 50x). */
export const MAX_LEVERAGE = 20;

/** Spot asset ids are 10000 + the spot universe index. */
export const SPOT_ASSET_OFFSET = 10000;

export const HYPERLIQUID_URLS: Record<
  HyperliquidEnv,
  { apiUrl: string; wsUrl: string }
> = {
  mainnet: { apiUrl: hl.MAINNET_API_URL, wsUrl: hl.MAINNET_API_WS_URL },
  testnet: { apiUrl: hl.TESTNET_API_URL, wsUrl: hl.TESTNET_API_WS_URL },
};

/** Bridge2 contract on Arbitrum One — verified against Hyperliquid docs. */
export const HYPERLIQUID_BRIDGE_ADDRESS =
  '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7';
/** Native USDC on Arbitrum One. */
export const HYPERLIQUID_ARBITRUM_USDC =
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
export const HYPERLIQUID_ARBITRUM_CHAIN_ID = 42161;
/** Deposits below this are not credited. */
export const HYPERLIQUID_MIN_DEPOSIT_USDC = 5;
export const HYPERLIQUID_TESTNET_FAUCET_URL =
  'https://app.hyperliquid-testnet.xyz/drip';
/** Mock USDC the testnet faucet pays per claim. */
export const HYPERLIQUID_TESTNET_FAUCET_AMOUNT_USDC = 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type HyperliquidErrorCode =
  | 'network'
  | 'market-not-found'
  | 'insufficient-margin'
  | 'invalid-order'
  | 'unauthorized'
  | 'unknown';

/** Typed, user-friendly error — safe to show in the UI. */
export class HyperliquidClientError extends Error {
  readonly code: HyperliquidErrorCode;
  constructor(code: HyperliquidErrorCode, message: string) {
    super(message);
    this.name = 'HyperliquidClientError';
    this.code = code;
  }
}

function isNetworkFailure(e: unknown): boolean {
  // The SDK wraps every transport failure in HttpRequestError; a bare
  // fetch throws TypeError when offline.
  if (e instanceof hl.HttpRequestError) return true;
  if (e instanceof TypeError) return true; // fetch throws TypeError offline
  const msg = e instanceof Error ? e.message : String(e);
  return /fetch failed|network|ECONNREFUSED|ENOTFOUND|timed? ?out|aborted/i.test(msg);
}

/** Map SDK / exchange failures to a typed, user-friendly error. */
export function mapHyperliquidError(e: unknown): HyperliquidClientError {
  if (e instanceof HyperliquidClientError) return e;
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (isNetworkFailure(e)) {
    return new HyperliquidClientError(
      'network',
      'Could not reach Hyperliquid. Check your connection and try again.',
    );
  }
  if (/insufficient (margin|balance|funds)|not enough (margin|balance|funds)|margin.*insufficient/i.test(lower)) {
    return new HyperliquidClientError(
      'insufficient-margin',
      'Not enough margin for this order. Reduce the size or add funds.',
    );
  }
  if (/asset .* not found|unknown (asset|coin)|invalid asset|market not found|coin .* not/i.test(lower)) {
    return new HyperliquidClientError('market-not-found', 'That market is not available on Hyperliquid.');
  }
  if (/signature|sign|unauthori[sz]ed|forbidden|invalid api|not approved/i.test(lower)) {
    return new HyperliquidClientError(
      'unauthorized',
      'Hyperliquid rejected the signature. Unlock your wallet and try again.',
    );
  }
  if (e instanceof hl.ValidationError || /invalid|must be|too (small|large)|size|price|leverage/i.test(lower)) {
    return new HyperliquidClientError('invalid-order', 'That order is not valid. Check the size and price.');
  }
  return new HyperliquidClientError('unknown', 'Something went wrong with Hyperliquid. Please try again.');
}

// ---------------------------------------------------------------------------
// Signing — the client never holds a key
// ---------------------------------------------------------------------------

/**
 * Anything that can EIP-712 sign for Hyperliquid. An ethers v6 Wallet /
 * HDNodeWallet (what the app decrypts for one action) satisfies this
 * structurally; so does the adapter built by {@link createCallbackSigner}.
 */
export interface HyperliquidSigner {
  signTypedData(
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    },
    types: Record<string, readonly { name: string; type: string }[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
  getAddress(): Promise<string>;
}

/**
 * Adapt a raw `signTypedData` callback (e.g. a signing modal that asks
 * for the session password and signs with the decrypted wallet) into a
 * signer the SDK accepts. The callback receives the same three arguments
 * an ethers v6 signer would.
 */
export function createCallbackSigner(
  address: string,
  signTypedData: (
    domain: Parameters<HyperliquidSigner['signTypedData']>[0],
    types: Parameters<HyperliquidSigner['signTypedData']>[1],
    value: Parameters<HyperliquidSigner['signTypedData']>[2],
  ) => Promise<string>,
): HyperliquidSigner {
  return {
    async signTypedData(domain, types, value) {
      return signTypedData(domain, types, value);
    },
    async getAddress() {
      return address;
    },
  };
}

// ---------------------------------------------------------------------------
// Market / account types
// ---------------------------------------------------------------------------

export interface PerpMarket {
  /** Index in the perp universe — the asset id used in orders. */
  assetIndex: number;
  name: string;
  /** Decimals for order sizes. */
  szDecimals: number;
  /** Max leverage Hyperliquid allows (app still caps at MAX_LEVERAGE). */
  maxLeverage: number;
  isDelisted: boolean;
}

export interface SpotToken {
  name: string;
  index: number;
  szDecimals: number;
  tokenId: string;
  isCanonical: boolean;
}

export interface SpotMarket {
  /** Asset id used in spot orders: 10000 + universe index. */
  assetIndex: number;
  /** e.g. "PURR/USDC". */
  name: string;
  baseTokenIndex: number;
  quoteTokenIndex: number;
  isCanonical: boolean;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export type CandleInterval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '8h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M';

export interface PerpPosition {
  coin: string;
  side: 'long' | 'short';
  /** Signed size (negative = short). */
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  leverage: number;
  marginUsed: number;
  unrealizedPnl: number;
  returnOnEquity: number;
}

export interface PerpAccountState {
  accountValue: number;
  totalMarginUsed: number;
  withdrawable: number;
  positions: PerpPosition[];
}

export interface SpotBalance {
  coin: string;
  total: number;
  hold: number;
  available: number;
}

export interface OpenOrder {
  oid: number;
  coin: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  originalSize: number;
  timestamp: number;
  cloid: string | null;
}

export interface OrderResult {
  status: 'resting' | 'filled' | 'error';
  /** Exchange order id, when the order was accepted. */
  oid: number | null;
  filledSize: number;
  averagePrice: number | null;
  error: string | null;
}

export interface DepositInfo {
  method: 'bridge' | 'faucet';
  /** Mainnet: Arbitrum chain id. Testnet: none (no on-chain tx). */
  chainId: number | null;
  /** Mainnet: native Arbitrum USDC contract. */
  usdcContract: string | null;
  /** Mainnet: Bridge2 contract to send USDC to. */
  bridgeAddress: string | null;
  minDepositUsdc: number | null;
  /** Testnet: faucet page. */
  faucetUrl: string | null;
  /** What the user has to do, in plain words. */
  instructions: string;
}

// ---------------------------------------------------------------------------
// Order formatting — Hyperliquid is strict about these
// ---------------------------------------------------------------------------

/** Expand scientific notation (e.g. 1e-7) to a plain decimal string. */
export function toPlainDecimalString(n: number): string {
  if (!Number.isFinite(n)) throw new Error('Price/size must be a finite number.');
  const s = String(n);
  if (!/[eE]/.test(s)) return s;
  const [mantissa, expStr] = s.split(/[eE]/);
  const exp = parseInt(expStr, 10);
  const neg = mantissa.startsWith('-');
  const digits = mantissa.replace('-', '').replace('.', '');
  const intPartLen = (mantissa.replace('-', '').split('.')[0] || '').length;
  const pointIndex = intPartLen + exp;
  let out: string;
  if (pointIndex <= 0) out = `0.${'0'.repeat(-pointIndex)}${digits}`;
  else if (pointIndex >= digits.length) out = digits + '0'.repeat(pointIndex - digits.length);
  else out = `${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
  return neg ? `-${out}` : out;
}

/**
 * Hyperliquid limit prices allow at most 5 significant figures.
 * Rounds to 5 sig figs and returns a plain decimal string.
 */
export function formatHyperliquidPrice(price: number): string {
  if (!(price > 0)) throw new Error('Price must be greater than zero.');
  const rounded = Number(price.toPrecision(5));
  return toPlainDecimalString(rounded);
}

/** Round a size to the market's szDecimals and return a plain decimal string. */
export function formatHyperliquidSize(size: number, szDecimals: number): string {
  if (!(size > 0)) throw new Error('Size must be greater than zero.');
  const factor = 10 ** szDecimals;
  const rounded = Math.round(size * factor) / factor;
  if (!(rounded > 0)) throw new Error('Size is too small for this market.');
  return toPlainDecimalString(rounded);
}

/** Random 16-byte client order id (0x + 32 hex chars), as the API expects. */
export function generateCloid(): `0x${string}` {
  return ethers.hexlify(ethers.randomBytes(16)) as `0x${string}`;
}

/** Clamp leverage to the app cap (and to at least 1x). Throws above the cap. */
export function validateLeverage(leverage: number, marketMax: number): number {
  if (!Number.isFinite(leverage) || leverage < 1) {
    throw new HyperliquidClientError('invalid-order', 'Leverage must be at least 1x.');
  }
  const whole = Math.floor(leverage);
  if (whole > MAX_LEVERAGE) {
    throw new HyperliquidClientError(
      'invalid-order',
      `Leverage is capped at ${MAX_LEVERAGE}x in this app.`,
    );
  }
  if (whole > marketMax) {
    throw new HyperliquidClientError(
      'invalid-order',
      `This market allows at most ${marketMax}x leverage.`,
    );
  }
  return whole;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HyperliquidClient {
  readonly env: HyperliquidEnv;
  private readonly transport: hl.HttpTransport;
  private readonly info: hl.InfoClient;
  private wsTransport: hl.WebSocketTransport | null = null;
  private subClient: hl.SubscriptionClient | null = null;
  private perpMetaCache: PerpMarket[] | null = null;
  private spotMetaCache: { tokens: SpotToken[]; markets: SpotMarket[] } | null = null;

  constructor(env: HyperliquidEnv = 'testnet') {
    this.env = env;
    this.transport = new hl.HttpTransport({
      apiUrl: HYPERLIQUID_URLS[env].apiUrl,
      // Critical: the SDK picks the L1 signing source ('a' mainnet vs
      // 'b' testnet) and the withdraw chain from this flag. A testnet
      // client built without it would sign mainnet actions.
      isTestnet: env === 'testnet',
    });
    this.info = new hl.InfoClient({ transport: this.transport });
  }

  // -- markets ---------------------------------------------------------------

  /** Perp universe: asset list with tick/lot sizes and max leverage. */
  async getPerpMarkets(forceRefresh = false): Promise<PerpMarket[]> {
    if (this.perpMetaCache && !forceRefresh) return this.perpMetaCache;
    try {
      const meta = await this.info.meta();
      const markets: PerpMarket[] = (meta.universe ?? []).map((u, i) => ({
        assetIndex: i,
        name: u.name,
        szDecimals: u.szDecimals,
        maxLeverage: u.maxLeverage,
        isDelisted: Boolean((u as { isDelisted?: boolean }).isDelisted),
      }));
      this.perpMetaCache = markets;
      return markets;
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Spot tokens + spot markets (pairs). */
  async getSpotMeta(
    forceRefresh = false,
  ): Promise<{ tokens: SpotToken[]; markets: SpotMarket[] }> {
    if (this.spotMetaCache && !forceRefresh) return this.spotMetaCache;
    try {
      const meta = await this.info.spotMeta();
      const tokens: SpotToken[] = (meta.tokens ?? []).map((t) => ({
        name: t.name,
        index: t.index,
        szDecimals: t.szDecimals,
        tokenId: t.tokenId,
        isCanonical: Boolean(t.isCanonical),
      }));
      const markets: SpotMarket[] = (meta.universe ?? []).map((u) => ({
        assetIndex: SPOT_ASSET_OFFSET + u.index,
        name: u.name,
        baseTokenIndex: u.tokens[0],
        quoteTokenIndex: u.tokens[1],
        isCanonical: Boolean(u.isCanonical),
      }));
      this.spotMetaCache = { tokens, markets };
      return this.spotMetaCache;
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Live mid prices for every coin (perps + spot), keyed by coin name. */
  async getAllMids(): Promise<Record<string, number>> {
    try {
      const mids = await this.info.allMids();
      const out: Record<string, number> = {};
      for (const [coin, px] of Object.entries(mids)) {
        const n = Number(px);
        if (Number.isFinite(n)) out[coin] = n;
      }
      return out;
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Live mid price for one coin. */
  async getMid(coin: string): Promise<number> {
    const mids = await this.getAllMids();
    const px = mids[coin];
    if (px === undefined) {
      throw new HyperliquidClientError('market-not-found', `No live price for ${coin}.`);
    }
    return px;
  }

  /** Candle history for a coin. Times are ms since epoch. */
  async getCandles(
    coin: string,
    interval: CandleInterval,
    startTime: number,
    endTime: number,
  ): Promise<Candle[]> {
    try {
      const rows = await this.info.candleSnapshot({ coin, interval, startTime, endTime });
      return (rows ?? []).map((r) => ({
        time: Number(r.t),
        open: Number(r.o),
        high: Number(r.h),
        low: Number(r.l),
        close: Number(r.c),
        volume: Number(r.v),
        trades: Number(r.n),
      }));
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  // -- account ---------------------------------------------------------------

  /** Perp account: margin used/available, positions with entry/mark/liquidation. */
  async getPerpAccountState(address: string): Promise<PerpAccountState> {
    try {
      // clearinghouseState carries no mark price — take it from live mids.
      const [state, mids] = await Promise.all([
        this.info.clearinghouseState({ user: address as `0x${string}` }),
        this.info.allMids(),
      ]);
      const positions: PerpPosition[] = (state.assetPositions ?? [])
        .map((ap) => ap.position)
        .filter((p) => Number(p.szi) !== 0)
        .map((p) => {
          const size = Number(p.szi);
          return {
            coin: p.coin,
            side: size >= 0 ? ('long' as const) : ('short' as const),
            size,
            entryPrice: Number(p.entryPx),
            markPrice: Number(mids[p.coin] ?? p.entryPx),
            liquidationPrice:
              p.liquidationPx !== null && p.liquidationPx !== undefined
                ? Number(p.liquidationPx)
                : null,
            leverage: Number(p.leverage?.value ?? 1),
            marginUsed: Number(p.marginUsed),
            unrealizedPnl: Number(p.unrealizedPnl),
            returnOnEquity: Number(p.returnOnEquity),
          };
        });
      return {
        accountValue: Number(state.marginSummary?.accountValue ?? 0),
        totalMarginUsed: Number(state.marginSummary?.totalMarginUsed ?? 0),
        withdrawable: Number(state.withdrawable ?? 0),
        positions,
      };
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Spot balances (USDC + tokens). */
  async getSpotBalances(address: string): Promise<SpotBalance[]> {
    try {
      const state = await this.info.spotClearinghouseState({ user: address as `0x${string}` });
      return (state.balances ?? []).map((b) => ({
        coin: b.coin,
        total: Number(b.total),
        hold: Number(b.hold),
        available: Math.max(0, Number(b.total) - Number(b.hold)),
      }));
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Open orders for an account (perps + spot). */
  async getOpenOrders(address: string): Promise<OpenOrder[]> {
    try {
      const orders = await this.info.openOrders({ user: address as `0x${string}` });
      return (orders ?? []).map((o) => ({
        oid: Number(o.oid),
        coin: o.coin,
        side: o.side === 'B' ? ('buy' as const) : ('sell' as const),
        price: Number(o.limitPx),
        size: Number(o.sz),
        originalSize: Number(o.origSz),
        timestamp: Number(o.timestamp),
        cloid: o.cloid ?? null,
      }));
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  // -- trading ---------------------------------------------------------------

  private async exchange(signer: HyperliquidSigner): Promise<hl.ExchangeClient> {
    // The ExchangeClient is built per call with the caller's signer and
    // dropped afterwards — the client never stores a signer or a key.
    return new hl.ExchangeClient({
      transport: this.transport,
      wallet: signer as never,
    });
  }

  private async resolvePerpMarket(coin: string): Promise<PerpMarket> {
    const markets = await this.getPerpMarkets();
    const market = markets.find((m) => m.name === coin && !m.isDelisted);
    if (!market) {
      throw new HyperliquidClientError('market-not-found', `${coin} is not a listed perp market.`);
    }
    return market;
  }

  private async resolveSpotMarket(pair: string): Promise<SpotMarket> {
    const { markets } = await this.getSpotMeta();
    const market = markets.find((m) => m.name === pair);
    if (!market) {
      throw new HyperliquidClientError('market-not-found', `${pair} is not a listed spot market.`);
    }
    return market;
  }

  /**
   * Exchange responses carry `{ status: 'err', response: '<message>' }`
   * on failure. Returns the message, or null when the call succeeded.
   */
  private static exchangeError(res: unknown): string | null {
    const r = res as { status?: unknown; response?: unknown } | null;
    if (r && r.status === 'err') {
      return typeof r.response === 'string' ? r.response : 'Request rejected.';
    }
    return null;
  }

  private parseOrderResponse(res: unknown): OrderResult {
    const r = res as {
      status?: string;
      response?: { type?: string; data?: { statuses?: unknown[] } } | string;
    };
    if (r?.status === 'err') {
      throw mapHyperliquidError(new Error(typeof r.response === 'string' ? r.response : 'Order rejected.'));
    }
    const statuses = r?.response && typeof r.response === 'object' ? r.response.data?.statuses ?? [] : [];
    const first = (statuses[0] ?? {}) as Record<string, unknown>;
    if (first.error) {
      throw mapHyperliquidError(new Error(String(first.error)));
    }
    if (first.resting && typeof first.resting === 'object') {
      const resting = first.resting as { oid?: number };
      return { status: 'resting', oid: resting.oid ?? null, filledSize: 0, averagePrice: null, error: null };
    }
    if (first.filled && typeof first.filled === 'object') {
      const filled = first.filled as { totalSz?: string; avgPx?: string; oid?: number };
      return {
        status: 'filled',
        oid: filled.oid ?? null,
        filledSize: Number(filled.totalSz ?? 0),
        averagePrice: filled.avgPx ? Number(filled.avgPx) : null,
        error: null,
      };
    }
    return { status: 'resting', oid: null, filledSize: 0, averagePrice: null, error: null };
  }

  /**
   * Place a perp limit order. `tif` defaults to Gtc (good-til-cancelled).
   */
  async placePerpLimitOrder(
    signer: HyperliquidSigner,
    opts: {
      coin: string;
      isBuy: boolean;
      size: number;
      price: number;
      reduceOnly?: boolean;
      tif?: 'Gtc' | 'Ioc' | 'Alo';
    },
  ): Promise<OrderResult> {
    try {
      const market = await this.resolvePerpMarket(opts.coin);
      const client = await this.exchange(signer);
      const res = await client.order({
        orders: [
          {
            a: market.assetIndex,
            b: opts.isBuy,
            p: formatHyperliquidPrice(opts.price),
            s: formatHyperliquidSize(opts.size, market.szDecimals),
            r: opts.reduceOnly ?? false,
            t: { limit: { tif: opts.tif ?? 'Gtc' } },
            c: generateCloid(),
          },
        ],
        grouping: 'na',
      });
      return this.parseOrderResponse(res);
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /**
   * Place a perp market order — implemented as an IOC limit order priced
   * `slippage` (default 1%) through the live mid, so it fills immediately
   * or not at all.
   */
  async placePerpMarketOrder(
    signer: HyperliquidSigner,
    opts: { coin: string; isBuy: boolean; size: number; slippage?: number },
  ): Promise<OrderResult> {
    const mid = await this.getMid(opts.coin);
    const slip = opts.slippage ?? 0.01;
    const price = opts.isBuy ? mid * (1 + slip) : mid * (1 - slip);
    return this.placePerpLimitOrder(signer, {
      coin: opts.coin,
      isBuy: opts.isBuy,
      size: opts.size,
      price,
      tif: 'Ioc',
    });
  }

  /** Place a spot limit order. `pair` is e.g. "PURR/USDC". */
  async placeSpotLimitOrder(
    signer: HyperliquidSigner,
    opts: {
      pair: string;
      isBuy: boolean;
      size: number;
      price: number;
      tif?: 'Gtc' | 'Ioc' | 'Alo';
    },
  ): Promise<OrderResult> {
    try {
      const market = await this.resolveSpotMarket(opts.pair);
      const { tokens } = await this.getSpotMeta();
      const base = tokens.find((t) => t.index === market.baseTokenIndex);
      const szDecimals = base?.szDecimals ?? 8;
      const client = await this.exchange(signer);
      const res = await client.order({
        orders: [
          {
            a: market.assetIndex,
            b: opts.isBuy,
            p: formatHyperliquidPrice(opts.price),
            s: formatHyperliquidSize(opts.size, szDecimals),
            r: false,
            t: { limit: { tif: opts.tif ?? 'Gtc' } },
            c: generateCloid(),
          },
        ],
        grouping: 'na',
      });
      return this.parseOrderResponse(res);
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Place a spot market order (IOC limit through the mid, default 1% slippage). */
  async placeSpotMarketOrder(
    signer: HyperliquidSigner,
    opts: { pair: string; isBuy: boolean; size: number; slippage?: number },
  ): Promise<OrderResult> {
    const base = opts.pair.split('/')[0];
    const mid = await this.getMid(base);
    const slip = opts.slippage ?? 0.01;
    const price = opts.isBuy ? mid * (1 + slip) : mid * (1 - slip);
    return this.placeSpotLimitOrder(signer, { ...opts, price, tif: 'Ioc' });
  }

  /**
   * Place a take-profit or stop-loss trigger order for a position.
   * Market trigger: fills at market once the trigger price is hit.
   */
  async placeTpSlOrder(
    signer: HyperliquidSigner,
    opts: {
      coin: string;
      /** true = buy to close a short / take profit on a short; false = sell. */
      isBuy: boolean;
      size: number;
      triggerPrice: number;
      kind: 'tp' | 'sl';
    },
  ): Promise<OrderResult> {
    try {
      const market = await this.resolvePerpMarket(opts.coin);
      const client = await this.exchange(signer);
      const res = await client.order({
        orders: [
          {
            a: market.assetIndex,
            b: opts.isBuy,
            p: formatHyperliquidPrice(opts.triggerPrice),
            s: formatHyperliquidSize(opts.size, market.szDecimals),
            r: true,
            t: { trigger: { isMarket: true, triggerPx: formatHyperliquidPrice(opts.triggerPrice), tpsl: opts.kind } },
            c: generateCloid(),
          },
        ],
        grouping: 'positionTpsl',
      });
      return this.parseOrderResponse(res);
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Cancel one order by exchange order id. */
  async cancelOrder(
    signer: HyperliquidSigner,
    opts: { coin: string; oid: number },
  ): Promise<void> {
    try {
      const market = await this.resolvePerpMarket(opts.coin);
      const client = await this.exchange(signer);
      const res = await client.cancel({ cancels: [{ a: market.assetIndex, o: opts.oid }] });
      const err = HyperliquidClient.exchangeError(res);
      if (err) throw new Error(err);
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Cancel every open order for an account. */
  async cancelAllOrders(signer: HyperliquidSigner, address: string): Promise<number> {
    const orders = await this.getOpenOrders(address);
    const markets = await this.getPerpMarkets();
    const spot = await this.getSpotMeta();
    const byCoin = new Map<string, number>();
    for (const m of markets) byCoin.set(m.name, m.assetIndex);
    for (const m of spot.markets) {
      const base = m.name.split('/')[0];
      byCoin.set(base, m.assetIndex);
    }
    const cancels = orders
      .map((o) => ({ a: byCoin.get(o.coin), o: o.oid }))
      .filter((c): c is { a: number; o: number } => c.a !== undefined);
    if (cancels.length === 0) return 0;
    try {
      const client = await this.exchange(signer);
      const res = await client.cancel({ cancels });
      const err = HyperliquidClient.exchangeError(res);
      if (err) throw new Error(err);
      return cancels.length;
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /**
   * Update leverage for a coin. Enforces the app cap (MAX_LEVERAGE = 20x)
   * and the market's own max. `isCross` defaults to true.
   */
  async updateLeverage(
    signer: HyperliquidSigner,
    opts: { coin: string; leverage: number; isCross?: boolean },
  ): Promise<void> {
    try {
      const market = await this.resolvePerpMarket(opts.coin);
      const lev = validateLeverage(opts.leverage, market.maxLeverage);
      const client = await this.exchange(signer);
      const res = await client.updateLeverage({
        asset: market.assetIndex,
        isCross: opts.isCross ?? true,
        leverage: lev,
      });
      const err = HyperliquidClient.exchangeError(res);
      if (err) throw new Error(err);
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Close a whole position with a reduce-only market order. */
  async closePosition(
    signer: HyperliquidSigner,
    opts: { coin: string; address: string; slippage?: number },
  ): Promise<OrderResult> {
    const state = await this.getPerpAccountState(opts.address);
    const pos = state.positions.find((p) => p.coin === opts.coin);
    if (!pos) {
      throw new HyperliquidClientError('invalid-order', `No open ${opts.coin} position to close.`);
    }
    const mid = await this.getMid(opts.coin);
    const slip = opts.slippage ?? 0.01;
    const isBuy = pos.size < 0; // buy back a short, sell a long
    const price = isBuy ? mid * (1 + slip) : mid * (1 - slip);
    return this.placePerpLimitOrder(signer, {
      coin: opts.coin,
      isBuy,
      size: Math.abs(pos.size),
      price,
      reduceOnly: true,
      tif: 'Ioc',
    });
  }

  // -- funding ---------------------------------------------------------------

  /** How to fund the account on this env — info only, no transaction. */
  getDepositInfo(): DepositInfo {
    if (this.env === 'testnet') {
      return {
        method: 'faucet',
        chainId: null,
        usdcContract: null,
        bridgeAddress: null,
        minDepositUsdc: null,
        faucetUrl: HYPERLIQUID_TESTNET_FAUCET_URL,
        instructions: `Claim ${HYPERLIQUID_TESTNET_FAUCET_AMOUNT_USDC.toLocaleString()} mock USDC from the testnet faucet. The faucet only pays addresses that have deposited on mainnet at least once with the same address. Testnet funds are not real money.`,
      };
    }
    return {
      method: 'bridge',
      chainId: HYPERLIQUID_ARBITRUM_CHAIN_ID,
      usdcContract: HYPERLIQUID_ARBITRUM_USDC,
      bridgeAddress: HYPERLIQUID_BRIDGE_ADDRESS,
      minDepositUsdc: HYPERLIQUID_MIN_DEPOSIT_USDC,
      faucetUrl: null,
      instructions: `Send native USDC on Arbitrum One to the Hyperliquid bridge. Minimum ${HYPERLIQUID_MIN_DEPOSIT_USDC} USDC — smaller deposits are not credited. It is credited to the sending address in under a minute.`,
    };
  }

  /**
   * Withdraw USDC from Hyperliquid to an Arbitrum address. This is a
   * user-signed action (EIP-712, Hyperliquid chain) — the signer is asked
   * to sign it, no key is ever held here.
   */
  async withdraw(
    signer: HyperliquidSigner,
    opts: { destination: string; amount: number },
  ): Promise<void> {
    if (!(opts.amount > 0)) {
      throw new HyperliquidClientError('invalid-order', 'Withdrawal amount must be greater than zero.');
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(opts.destination)) {
      throw new HyperliquidClientError('invalid-order', 'That withdrawal address is not valid.');
    }
    try {
      const client = await this.exchange(signer);
      const res = await client.withdraw3({
        destination: opts.destination as `0x${string}`,
        amount: toPlainDecimalString(opts.amount),
      });
      const err = HyperliquidClient.exchangeError(res);
      if (err) throw new Error(err);
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  // -- live prices over WebSocket --------------------------------------------

  /**
   * Subscribe to live mid prices for all coins. The SDK's transport
   * reconnects automatically and re-subscribes after a drop, so a
   * disconnect never crashes the app — the listener simply stops being
   * called until the connection comes back. Returns an unsubscribe
   * function; call {@link disconnect} when the client is done for good.
   */
  async subscribeAllMids(
    listener: (mids: Record<string, number>) => void,
  ): Promise<() => void> {
    try {
      if (!this.wsTransport) {
        this.wsTransport = new hl.WebSocketTransport({
          url: HYPERLIQUID_URLS[this.env].wsUrl,
          isTestnet: this.env === 'testnet',
          resubscribe: true,
        });
        this.subClient = new hl.SubscriptionClient({ transport: this.wsTransport });
      }
      const sub = await this.subClient!.allMids((data) => {
        const mids: Record<string, number> = {};
        for (const [coin, px] of Object.entries(data.mids ?? {})) {
          const n = Number(px);
          if (Number.isFinite(n)) mids[coin] = n;
        }
        listener(mids);
      });
      return () => {
        void sub.unsubscribe().catch(() => undefined);
      };
    } catch (e) {
      throw mapHyperliquidError(e);
    }
  }

  /** Close the WebSocket connection, if one was opened. */
  disconnect(): void {
    try {
      this.wsTransport?.socket?.close();
    } catch {
      // never throw from teardown
    }
    this.wsTransport = null;
    this.subClient = null;
  }
}

/** Default client: testnet, as the app ships testnet-first. */
export const hyperliquid = new HyperliquidClient('testnet');
