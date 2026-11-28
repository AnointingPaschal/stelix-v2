/**
 * Tests for the Trade screen's pure helpers (src/lib/trade.ts). The
 * Trade screen itself (src/app/(tabs)/trade.tsx) and its
 * TradeConfirmSheet were removed on 2026-11-28 when Discover was
 * restored — the helpers and the Hyperliquid client stay dormant in
 * place until Trade returns, so only the pure-helper tests remain.
 */
import * as fs from 'fs';
import * as path from 'path';
import { MAX_LEVERAGE } from '../hyperliquid';
import {
  DEFAULT_TRADE_ENV,
  buildClosePositionSummary,
  buildPerpOrderSummary,
  buildSpotOrderSummary,
  buildWithdrawSummary,
  clampLeverage,
  depositExplainer,
  envBadge,
  estimateLiquidationPrice,
  estimateTakerFee,
  filterTradeMarkets,
  parseTradeAmount,
  sizeFromUsdc,
  spotTotal,
  usdcFromSize,
} from '../trade';

const MOBILE = path.resolve(__dirname, '..', '..', '..');
function src(rel: string): string {
  return fs.readFileSync(path.join(MOBILE, rel), 'utf8');
}
const TRADE_LIB = 'src/lib/trade.ts';

describe('leverage cap', () => {
  it('MAX_LEVERAGE is 20', () => {
    expect(MAX_LEVERAGE).toBe(20);
  });

  it('clamps anything above 20x down to 20x', () => {
    expect(clampLeverage(50, 50)).toBe(20);
    expect(clampLeverage(21, 40)).toBe(20);
    expect(clampLeverage(100, 100)).toBe(20);
  });

  it('respects a market max below the app cap', () => {
    expect(clampLeverage(20, 10)).toBe(10);
    expect(clampLeverage(5, 10)).toBe(5);
  });

  it('floors to whole numbers and never goes below 1x', () => {
    expect(clampLeverage(5.9, 40)).toBe(5);
    expect(clampLeverage(0, 40)).toBe(1);
    expect(clampLeverage(-3, 40)).toBe(1);
    expect(clampLeverage(NaN, 40)).toBe(1);
  });
});

describe('amount helpers', () => {
  it('parses typed amounts, treating junk as 0', () => {
    expect(parseTradeAmount('10.5')).toBe(10.5);
    expect(parseTradeAmount('')).toBe(0);
    expect(parseTradeAmount('abc')).toBe(0);
    expect(parseTradeAmount('-5')).toBe(0);
  });

  it('converts between USDC and coin size', () => {
    expect(sizeFromUsdc(100, 50)).toBe(2);
    expect(sizeFromUsdc(100, 0)).toBe(0);
    expect(usdcFromSize(2, 50)).toBe(100);
    expect(spotTotal(2, 50)).toBe(100);
  });

  it('estimates the taker fee on a notional', () => {
    expect(estimateTakerFee(1000)).toBeCloseTo(0.35, 10);
    expect(estimateTakerFee(0)).toBe(0);
  });
});

describe('liquidation estimate', () => {
  it('long liquidates below entry, short above it', () => {
    expect(estimateLiquidationPrice(60000, 10, 'long')).toBeCloseTo(54000, 6);
    expect(estimateLiquidationPrice(60000, 10, 'short')).toBeCloseTo(66000, 6);
  });

  it('returns null at 1x', () => {
    expect(estimateLiquidationPrice(60000, 1, 'long')).toBeNull();
  });
});

describe('order summary formatting', () => {
  it('formats a spot buy summary with side, market, size, price and total', () => {
    const s = buildSpotOrderSummary({
      side: 'buy',
      pair: 'PURR/USDC',
      size: 10,
      price: 0.5,
      orderType: 'limit',
      env: 'testnet',
    });
    expect(s.title).toMatch(/Buy PURR/);
    expect(s.title).toMatch(/Testnet/);
    const byLabel = (label: string) => s.lines.find((l) => l.label === label)?.value;
    expect(byLabel('Side')).toBe('Buy');
    expect(byLabel('Market')).toBe('PURR/USDC');
    expect(byLabel('Size')).toMatch(/10 PURR/);
    expect(byLabel('Price')).toBe('$0.50');
    expect(byLabel('Total')).toBe('$5.00');
    expect(byLabel('Est. fee (0.035% taker)')).toBeDefined();
  });

  it('formats a perp summary with leverage capped at 20x and a liquidation price', () => {
    const s = buildPerpOrderSummary({
      side: 'long',
      coin: 'BTC',
      size: 0.01,
      price: 60000,
      orderType: 'market',
      leverage: 50,
      takeProfit: 65000,
      stopLoss: 55000,
      env: 'testnet',
    });
    const byLabel = (label: string) => s.lines.find((l) => l.label === label)?.value;
    expect(byLabel('Leverage')).toBe('20x');
    expect(byLabel('Side')).toBe('Long');
    expect(byLabel('Notional')).toBe('$600.00');
    expect(byLabel('Margin used')).toBe('$30.00');
    expect(byLabel('Est. liquidation price')).toBe('$57,000.00');
    expect(byLabel('Take profit')).toBe('$65,000.00');
    expect(byLabel('Stop loss')).toBe('$55,000.00');
    expect(s.title).toMatch(/Long BTC 20x/);
  });

  it('omits TP/SL lines when none are set', () => {
    const s = buildPerpOrderSummary({
      side: 'short',
      coin: 'ETH',
      size: 1,
      price: 2000,
      orderType: 'limit',
      leverage: 5,
      takeProfit: null,
      stopLoss: null,
      env: 'mainnet',
    });
    expect(s.lines.some((l) => l.label === 'Take profit')).toBe(false);
    expect(s.lines.some((l) => l.label === 'Stop loss')).toBe(false);
    expect(s.title).toMatch(/Mainnet/);
    expect(s.lines.find((l) => l.label === 'Funds')?.value).toMatch(/Real money/);
  });

  it('formats a withdraw summary to Arbitrum', () => {
    const s = buildWithdrawSummary({
      amount: 25,
      destination: '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
      env: 'testnet',
    });
    expect(s.lines.find((l) => l.label === 'Destination network')?.value).toBe('Arbitrum');
    expect(s.lines.find((l) => l.label === 'Amount')?.value).toBe('$25.00');
  });

  it('formats a close-position summary with signed P&L', () => {
    const s = buildClosePositionSummary({
      coin: 'BTC',
      side: 'long',
      size: 0.01,
      markPrice: 61000,
      unrealizedPnl: -12.5,
      env: 'testnet',
    });
    expect(s.lines.find((l) => l.label === 'Unrealised P&L')?.value).toBe('$-12.50');
    expect(s.title).toMatch(/Close long BTC/);
  });
});

describe('env default', () => {
  it('defaults to testnet', () => {
    expect(DEFAULT_TRADE_ENV).toBe('testnet');
    expect(envBadge('testnet').note).toMatch(/Play money/);
    expect(envBadge('mainnet').note).toMatch(/Real money/);
  });

  it('market filter is case-insensitive', () => {
    expect(filterTradeMarkets(['BTC', 'ETH', 'SOL'], 'bt')).toEqual(['BTC']);
    expect(filterTradeMarkets(['BTC', 'ETH'], '')).toEqual(['BTC', 'ETH']);
  });
});

describe('deposit honesty', () => {
  it('mainnet explainer says deposits come from Arbitrum and names the gas need', () => {
    const text = depositExplainer('mainnet');
    expect(text).toMatch(/Arbitrum/);
    expect(text).toMatch(/ETH for gas/);
    expect(text).toMatch(/minimum 5 USDC/);
    expect(text).not.toMatch(/one-tap/i);
  });

  it('testnet explainer points at the faucet and play money', () => {
    const text = depositExplainer('testnet');
    expect(text).toMatch(/faucet/);
    expect(text).toMatch(/play money/);
  });
});

describe('Trade screen removed (dormant helpers only)', () => {
  it('the Trade screen and TradeConfirmSheet are gone; the dormant libs stay', () => {
    expect(fs.existsSync(path.join(MOBILE, 'src', 'app', '(tabs)', 'trade.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE, 'src', 'components', 'TradeConfirmSheet.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE, 'src', 'lib', 'trade.ts'))).toBe(true);
    expect(fs.existsSync(path.join(MOBILE, 'src', 'lib', 'hyperliquid.ts'))).toBe(true);
  });

  it('the dormant libs say they are dormant', () => {
    expect(src('src/lib/trade.ts')).toMatch(/DORMANT/);
    expect(src('src/lib/hyperliquid.ts')).toMatch(/DORMANT/);
  });

  it('no screen still imports the dormant Trade libs', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(f);
        else if (/\.(tsx?)$/.test(entry.name)) {
          const text = fs.readFileSync(f, 'utf8');
          if (/from '.*\/lib\/(trade|hyperliquid)'/.test(text)) {
            offenders.push(path.relative(MOBILE, f));
          }
        }
      }
    };
    walk(path.join(MOBILE, 'src', 'app'));
    walk(path.join(MOBILE, 'src', 'components'));
    expect(offenders).toEqual([]);
  });
});

describe('trade lib source', () => {
  it('never allows leverage above MAX_LEVERAGE in the helper', () => {
    const text = src(TRADE_LIB);
    expect(text).toMatch(/Math\.min\(MAX_LEVERAGE/);
  });
});
