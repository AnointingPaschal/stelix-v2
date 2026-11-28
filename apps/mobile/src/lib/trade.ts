/** DORMANT — the Trade tab was removed on 2026-11-28 (Discover restored).
 *  These helpers and their tests are kept in place until Trade returns.
 */
/**
 * Pure helpers for the Trade screen (src/app/(tabs)/trade.tsx).
 *
 * Kept dependency-free apart from the Hyperliquid client constants so
 * they are unit-testable in the node-only jest setup. Nothing here
 * touches the network, storage or a signer.
 */
import { MAX_LEVERAGE, type HyperliquidEnv } from './hyperliquid';

/** The Trade screen always opens on testnet — mainnet is an explicit flip. */
export const DEFAULT_TRADE_ENV: HyperliquidEnv = 'testnet';

/** Hyperliquid taker fee used only for the pre-trade estimate (0.035%). */
export const TAKER_FEE_RATE = 0.00035;

/**
 * Clamp a leverage input to the app cap (MAX_LEVERAGE = 20x) and the
 * market's own max, floored to a whole number, minimum 1x.
 * Never returns more than MAX_LEVERAGE, whatever the caller passes.
 */
export function clampLeverage(input: number, marketMax: number): number {
  if (!Number.isFinite(input)) return 1;
  const whole = Math.floor(input);
  const cap = Math.min(MAX_LEVERAGE, Math.max(1, Math.floor(marketMax)));
  return Math.min(cap, Math.max(1, whole));
}

/** Parse a typed amount: non-numeric, negative and empty input become 0. */
export function parseTradeAmount(raw: string): number {
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Notional value of a spot order. */
export function spotTotal(size: number, price: number): number {
  return size * price;
}

/** Coin size bought with a USDC amount at a given price. */
export function sizeFromUsdc(usdc: number, price: number): number {
  if (!(price > 0) || !(usdc > 0)) return 0;
  return usdc / price;
}

/** USDC value of a coin size at a given price. */
export function usdcFromSize(size: number, price: number): number {
  return size * price;
}

/**
 * Rough cross-margin liquidation estimate: long liquidates near
 * entry * (1 - 1/leverage), short near entry * (1 + 1/leverage).
 * An estimate only — the exchange's maintenance margin moves it.
 * Returns null at 1x (no liquidation risk from leverage alone).
 */
export function estimateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: 'long' | 'short',
): number | null {
  if (!(entryPrice > 0) || !(leverage > 1)) return null;
  return side === 'long'
    ? entryPrice * (1 - 1 / leverage)
    : entryPrice * (1 + 1 / leverage);
}

/** Estimated taker fee on a notional, in USDC. */
export function estimateTakerFee(notionalUsdc: number): number {
  if (!(notionalUsdc > 0)) return 0;
  return notionalUsdc * TAKER_FEE_RATE;
}

export interface SummaryLine {
  label: string;
  value: string;
}

export interface OrderSummary {
  title: string;
  lines: SummaryLine[];
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function coinAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** Confirmation summary for a spot buy/sell order. */
export function buildSpotOrderSummary(opts: {
  side: 'buy' | 'sell';
  pair: string;
  size: number;
  price: number;
  orderType: 'market' | 'limit';
  env: HyperliquidEnv;
}): OrderSummary {
  const total = spotTotal(opts.size, opts.price);
  const base = opts.pair.split('/')[0];
  return {
    title: `${opts.side === 'buy' ? 'Buy' : 'Sell'} ${base} (${opts.env === 'testnet' ? 'Testnet' : 'Mainnet'})`,
    lines: [
      { label: 'Side', value: opts.side === 'buy' ? 'Buy' : 'Sell' },
      { label: 'Market', value: opts.pair },
      { label: 'Type', value: opts.orderType === 'market' ? 'Market' : 'Limit' },
      { label: 'Size', value: `${coinAmount(opts.size)} ${base}` },
      { label: 'Price', value: opts.orderType === 'market' ? `Market (≈ ${money(opts.price)})` : money(opts.price) },
      { label: 'Total', value: money(total) },
      { label: 'Est. fee (0.035% taker)', value: money(estimateTakerFee(total)) },
      {
        label: 'Funds',
        value: opts.env === 'testnet' ? 'Testnet play money — not real funds' : 'Real money — Hyperliquid margin only',
      },
    ],
  };
}

/** Confirmation summary for a perp long/short order. */
export function buildPerpOrderSummary(opts: {
  side: 'long' | 'short';
  coin: string;
  size: number;
  price: number;
  orderType: 'market' | 'limit';
  leverage: number;
  takeProfit: number | null;
  stopLoss: number | null;
  env: HyperliquidEnv;
}): OrderSummary {
  const lev = clampLeverage(opts.leverage, MAX_LEVERAGE);
  const notional = usdcFromSize(opts.size, opts.price);
  const liq = estimateLiquidationPrice(opts.price, lev, opts.side);
  const lines: SummaryLine[] = [
    { label: 'Side', value: opts.side === 'long' ? 'Long' : 'Short' },
    { label: 'Market', value: `${opts.coin} perpetual` },
    { label: 'Type', value: opts.orderType === 'market' ? 'Market' : 'Limit' },
    { label: 'Size', value: `${coinAmount(opts.size)} ${opts.coin}` },
    { label: 'Price', value: opts.orderType === 'market' ? `Market (≈ ${money(opts.price)})` : money(opts.price) },
    { label: 'Notional', value: money(notional) },
    { label: 'Leverage', value: `${lev}x` },
    { label: 'Margin used', value: money(notional / lev) },
    {
      label: 'Est. liquidation price',
      value: liq !== null ? money(liq) : '— (1x has no leverage liquidation)',
    },
    { label: 'Est. fee (0.035% taker)', value: money(estimateTakerFee(notional)) },
  ];
  if (opts.takeProfit !== null) lines.push({ label: 'Take profit', value: money(opts.takeProfit) });
  if (opts.stopLoss !== null) lines.push({ label: 'Stop loss', value: money(opts.stopLoss) });
  lines.push({
    label: 'Funds',
    value: opts.env === 'testnet' ? 'Testnet play money — not real funds' : 'Real money — Hyperliquid margin only',
  });
  return {
    title: `${opts.side === 'long' ? 'Long' : 'Short'} ${opts.coin} ${lev}x (${opts.env === 'testnet' ? 'Testnet' : 'Mainnet'})`,
    lines,
  };
}

/** Confirmation summary for a USDC withdrawal back to Arbitrum. */
export function buildWithdrawSummary(opts: {
  amount: number;
  destination: string;
  env: HyperliquidEnv;
}): OrderSummary {
  return {
    title: `Withdraw ${money(opts.amount)} USDC (${opts.env === 'testnet' ? 'Testnet' : 'Mainnet'})`,
    lines: [
      { label: 'Amount', value: money(opts.amount) },
      { label: 'To', value: opts.destination },
      { label: 'Destination network', value: 'Arbitrum' },
      {
        label: 'Funds',
        value: opts.env === 'testnet' ? 'Testnet play money — not real funds' : 'Real money',
      },
    ],
  };
}

/** Confirmation summary for closing a perp position. */
export function buildClosePositionSummary(opts: {
  coin: string;
  side: 'long' | 'short';
  size: number;
  markPrice: number;
  unrealizedPnl: number;
  env: HyperliquidEnv;
}): OrderSummary {
  return {
    title: `Close ${opts.side} ${opts.coin} (${opts.env === 'testnet' ? 'Testnet' : 'Mainnet'})`,
    lines: [
      { label: 'Position', value: `${opts.side === 'long' ? 'Long' : 'Short'} ${coinAmount(Math.abs(opts.size))} ${opts.coin}` },
      { label: 'Mark price', value: money(opts.markPrice) },
      {
        label: 'Unrealised P&L',
        value: `${opts.unrealizedPnl >= 0 ? '+' : ''}${money(opts.unrealizedPnl)}`,
      },
      {
        label: 'Funds',
        value: opts.env === 'testnet' ? 'Testnet play money — not real funds' : 'Real money — Hyperliquid margin only',
      },
    ],
  };
}

/** Case-insensitive substring filter for the market picker list. */
export function filterTradeMarkets(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...names].sort((a, b) => a.localeCompare(b));
  return names
    .filter((n) => n.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));
}

/** Badge text for the environment switch — shown on every trade surface. */
export function envBadge(env: HyperliquidEnv): { label: string; note: string } {
  return env === 'testnet'
    ? { label: 'Testnet', note: 'Play money — no real funds' }
    : { label: 'Mainnet', note: 'Real money' };
}

/**
 * Plain-words funding explainer for the funding card. Mainnet deposits
 * come from Arbitrum — there is no one-tap cross-chain deposit here:
 * the user sends USDC to the Hyperliquid bridge on Arbitrum and needs
 * USDC on Arbitrum plus a little ETH for gas.
 */
export function depositExplainer(env: HyperliquidEnv): string {
  if (env === 'testnet') {
    return 'Testnet uses play money. Claim 1,000 mock USDC from the Hyperliquid testnet faucet — it only pays addresses that have deposited on mainnet at least once.';
  }
  return 'Deposits come from Arbitrum. Send native USDC on Arbitrum to the Hyperliquid bridge (minimum 5 USDC — smaller deposits are not credited). You need USDC on Arbitrum plus a little ETH for gas. It is credited to the sending address in under a minute.';
}
