/**
 * Unit tests for the Hyperliquid client (src/lib/hyperliquid.ts).
 *
 * Network is mocked: the SDK's HttpTransport uses global fetch, so the
 * tests stub fetch and assert on the exact request bodies the client
 * sends, including the EIP-712 signed exchange payload (signed with a
 * throwaway in-memory wallet — never a real key).
 *
 * Live testnet calls live in hyperliquid.live.test.ts and only run with
 * HL_LIVE_TESTS=1.
 */
import { ethers } from 'ethers';
import {
  HyperliquidClient,
  HyperliquidClientError,
  MAX_LEVERAGE,
  SPOT_ASSET_OFFSET,
  createCallbackSigner,
  formatHyperliquidPrice,
  formatHyperliquidSize,
  generateCloid,
  mapHyperliquidError,
  toPlainDecimalString,
  validateLeverage,
  HYPERLIQUID_BRIDGE_ADDRESS,
  HYPERLIQUID_MIN_DEPOSIT_USDC,
  HYPERLIQUID_TESTNET_FAUCET_URL,
} from '../hyperliquid';

const TESTNET_META = {
  universe: [
    { szDecimals: 5, name: 'BTC', maxLeverage: 40, marginTableId: 54 },
    { szDecimals: 4, name: 'ETH', maxLeverage: 25, marginTableId: 53 },
    { szDecimals: 2, name: 'SOL', maxLeverage: 10, marginTableId: 10 },
  ],
};

const TESTNET_SPOT_META = {
  tokens: [
    { name: 'USDC', szDecimals: 8, weiDecimals: 8, index: 0, tokenId: '0xeb62eee3685fc4c43992febcd9e75443', isCanonical: true },
    { name: 'PURR', szDecimals: 0, weiDecimals: 0, index: 1, tokenId: '0x9a39c31c9b3a0a34c4c4f1a5a5a5a5a5a5a5a5a5', isCanonical: true },
  ],
  universe: [
    { name: 'PURR/USDC', tokens: [1, 0], index: 0, isCanonical: true },
  ],
};

const TESTNET_MIDS = { BTC: '60664.5', ETH: '1664.75', SOL: '89.12' };

const CLEARINGHOUSE = {
  marginSummary: { accountValue: '100.0', totalNtlPos: '50.0', totalRawUsd: '100.0', totalMarginUsed: '10.0' },
  crossMarginSummary: { accountValue: '100.0', totalNtlPos: '50.0', totalRawUsd: '100.0', totalMarginUsed: '10.0' },
  crossMaintenanceMarginUsed: '1.0',
  withdrawable: '90.0',
  assetPositions: [
    {
      position: {
        coin: 'BTC',
        szi: '0.01',
        entryPx: '60000.0',
        markPx: '60664.5',
        liquidationPx: '55000.0',
        leverage: { type: 'cross', value: 5 },
        marginUsed: '10.0',
        unrealizedPnl: '6.645',
        returnOnEquity: '0.06645',
        cumFunding: { allTime: '0.0', sinceOpen: '0.0', sinceChange: '0.0' },
      },
      type: 'oneWay',
    },
    {
      position: {
        coin: 'ETH',
        szi: '-0.5',
        entryPx: '1700.0',
        markPx: '1664.75',
        liquidationPx: null,
        leverage: { type: 'isolated', value: 3 },
        marginUsed: '5.0',
        unrealizedPnl: '17.625',
        returnOnEquity: '0.1',
        cumFunding: { allTime: '0.0', sinceOpen: '0.0', sinceChange: '0.0' },
      },
      type: 'oneWay',
    },
    { position: { coin: 'SOL', szi: '0.0', entryPx: '0.0' }, type: 'oneWay' },
  ],
  time: 1795849630154,
};

const OPEN_ORDERS = [
  { coin: 'BTC', side: 'B', limitPx: '60000.0', sz: '0.01', oid: 123, timestamp: 1795849600000, origSz: '0.01', cloid: null },
  { coin: 'ETH', side: 'A', limitPx: '1700.0', sz: '0.5', oid: 124, timestamp: 1795849601000, origSz: '0.5', cloid: null },
];

/** Route stubbed fetch calls by info `type` and capture exchange bodies. */
function installFetchStub(captured: unknown[]) {
  const origFetch = global.fetch;
  const stub = jest.fn(async (_url: unknown, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    captured.push(body);
    let payload: unknown;
    if (body.type === 'meta') payload = TESTNET_META;
    else if (body.type === 'spotMeta') payload = TESTNET_SPOT_META;
    else if (body.type === 'allMids') payload = TESTNET_MIDS;
    else if (body.type === 'clearinghouseState') payload = CLEARINGHOUSE;
    else if (body.type === 'spotClearinghouseState') payload = { balances: [{ coin: 'USDC', token: 0, total: '100.0', hold: '5.0', entryNtl: '0.0' }] };
    else if (body.type === 'openOrders') payload = OPEN_ORDERS;
    else if (body.type === 'candleSnapshot') {
      payload = [{ t: 1792998000000, T: 1793001599999, s: 'BTC', i: '1h', o: '80562.0', c: '80444.0', h: '80665.0', l: '80416.0', v: '0.41908', n: 310 }];
    } else if (body.action) {
      // Exchange endpoint: echo a successful order-style response.
      const action = body.action as { type?: string };
      if (action.type === 'order') {
        payload = { status: 'ok', response: { type: 'order', data: { statuses: [{ resting: { oid: 999 } }] } } };
      } else if (action.type === 'cancel') {
        payload = { status: 'ok', response: { type: 'cancel', data: { statuses: ['success'] } } };
      } else {
        payload = { status: 'ok', response: { type: 'default' } };
      }
    } else {
      payload = {};
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  global.fetch = stub as unknown as typeof fetch;
  return () => {
    global.fetch = origFetch;
  };
}

describe('formatting helpers', () => {
  it('formats prices to at most 5 significant figures', () => {
    expect(formatHyperliquidPrice(60664.5)).toBe('60665');
    expect(formatHyperliquidPrice(1664.75)).toBe('1664.8');
    expect(formatHyperliquidPrice(0.000123456)).toBe('0.00012346');
    expect(formatHyperliquidPrice(89.12)).toBe('89.12');
    expect(formatHyperliquidPrice(1)).toBe('1');
  });

  it('rejects non-positive prices', () => {
    expect(() => formatHyperliquidPrice(0)).toThrow();
    expect(() => formatHyperliquidPrice(-5)).toThrow();
  });

  it('rounds sizes to szDecimals', () => {
    expect(formatHyperliquidSize(0.012345, 5)).toBe('0.01235');
    expect(formatHyperliquidSize(2.5, 2)).toBe('2.5');
    expect(formatHyperliquidSize(0.015, 2)).toBe('0.02');
  });

  it('rejects sizes that round to zero', () => {
    expect(() => formatHyperliquidSize(0.00001, 2)).toThrow();
  });

  it('expands scientific notation to plain decimals', () => {
    expect(toPlainDecimalString(1e-7)).toBe('0.0000001');
    expect(toPlainDecimalString(1.23e21)).toBe('1230000000000000000000');
    expect(toPlainDecimalString(60664.5)).toBe('60664.5');
    expect(toPlainDecimalString(-1.5e-3)).toBe('-0.0015');
  });

  it('generates 16-byte client order ids', () => {
    const a = generateCloid();
    const b = generateCloid();
    expect(a).toMatch(/^0x[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('leverage cap', () => {
  it('exports MAX_LEVERAGE = 20', () => {
    expect(MAX_LEVERAGE).toBe(20);
  });

  it('allows leverage up to the app cap and the market max', () => {
    expect(validateLeverage(20, 40)).toBe(20);
    expect(validateLeverage(10, 10)).toBe(10);
  });

  it('rejects leverage above the app cap even when the market allows more', () => {
    expect(() => validateLeverage(21, 50)).toThrow(HyperliquidClientError);
    expect(() => validateLeverage(50, 50)).toThrow(HyperliquidClientError);
  });

  it('rejects leverage above the market max', () => {
    expect(() => validateLeverage(15, 10)).toThrow(HyperliquidClientError);
  });

  it('rejects leverage below 1x', () => {
    expect(() => validateLeverage(0, 40)).toThrow(HyperliquidClientError);
  });

  it('floors fractional leverage', () => {
    expect(validateLeverage(5.9, 40)).toBe(5);
  });
});

describe('error mapping', () => {
  it('maps offline fetch failures to a friendly network error', () => {
    const err = mapHyperliquidError(new TypeError('fetch failed'));
    expect(err.code).toBe('network');
    expect(err.message).toMatch(/Could not reach Hyperliquid/);
    expect(err.message).not.toMatch(/fetch failed/);
  });

  it('maps insufficient margin messages', () => {
    expect(mapHyperliquidError(new Error('Insufficient margin to place order')).code).toBe('insufficient-margin');
  });

  it('maps unknown-market messages', () => {
    expect(mapHyperliquidError(new Error('Asset DOGE not found')).code).toBe('market-not-found');
  });

  it('maps signature failures to unauthorized', () => {
    expect(mapHyperliquidError(new Error('Invalid signature')).code).toBe('unauthorized');
  });

  it('passes typed errors through unchanged', () => {
    const original = new HyperliquidClientError('network', 'custom');
    expect(mapHyperliquidError(original)).toBe(original);
  });

  it('never leaks raw JSON in the message', () => {
    const err = mapHyperliquidError(new Error('{"status":"err","response":"insufficient margin"}'));
    expect(err.message).not.toContain('{');
  });
});

describe('HyperliquidClient (mocked network)', () => {
  let captured: unknown[];
  let restoreFetch: () => void;

  beforeEach(() => {
    captured = [];
    restoreFetch = installFetchStub(captured);
  });

  afterEach(() => {
    restoreFetch();
    jest.restoreAllMocks();
  });

  it('defaults to testnet', () => {
    const client = new HyperliquidClient();
    expect(client.env).toBe('testnet');
  });

  it('parses perp meta (asset list, sizes, max leverage)', async () => {
    const client = new HyperliquidClient('testnet');
    const markets = await client.getPerpMarkets();
    expect(markets).toHaveLength(3);
    expect(markets[0]).toEqual({ assetIndex: 0, name: 'BTC', szDecimals: 5, maxLeverage: 40, isDelisted: false });
    expect(markets[1].maxLeverage).toBe(25);
    // meta is fetched once and cached
    await client.getPerpMarkets();
    expect(captured.filter((b: any) => b.type === 'meta')).toHaveLength(1);
  });

  it('parses spot meta with 10000 + index asset ids', async () => {
    const client = new HyperliquidClient('testnet');
    const { tokens, markets } = await client.getSpotMeta();
    expect(tokens).toHaveLength(2);
    expect(markets[0].assetIndex).toBe(SPOT_ASSET_OFFSET + 0);
    expect(markets[0].name).toBe('PURR/USDC');
  });

  it('parses allMids into numbers', async () => {
    const client = new HyperliquidClient('testnet');
    const mids = await client.getAllMids();
    expect(mids.BTC).toBe(60664.5);
    expect(mids.ETH).toBe(1664.75);
  });

  it('throws market-not-found for an unknown mid', async () => {
    const client = new HyperliquidClient('testnet');
    await expect(client.getMid('DOGE')).rejects.toMatchObject({ code: 'market-not-found' });
  });

  it('parses candle history', async () => {
    const client = new HyperliquidClient('testnet');
    const candles = await client.getCandles('BTC', '1h', 1792998000000, 1793001600000);
    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({
      time: 1792998000000,
      open: 80562,
      high: 80665,
      low: 80416,
      close: 80444,
      volume: 0.41908,
      trades: 310,
    });
    expect((captured[0] as any).req.coin).toBe('BTC');
  });

  it('parses perp account state and drops zero-size positions', async () => {
    const client = new HyperliquidClient('testnet');
    const state = await client.getPerpAccountState('0x0000000000000000000000000000000000000001');
    expect(state.accountValue).toBe(100);
    expect(state.totalMarginUsed).toBe(10);
    expect(state.withdrawable).toBe(90);
    expect(state.positions).toHaveLength(2);
    expect(state.positions[0]).toEqual({
      coin: 'BTC',
      side: 'long',
      size: 0.01,
      entryPrice: 60000,
      markPrice: 60664.5,
      liquidationPrice: 55000,
      leverage: 5,
      marginUsed: 10,
      unrealizedPnl: 6.645,
      returnOnEquity: 0.06645,
    });
    expect(state.positions[1].side).toBe('short');
    expect(state.positions[1].liquidationPrice).toBeNull();
  });

  it('parses spot balances with available = total - hold', async () => {
    const client = new HyperliquidClient('testnet');
    const balances = await client.getSpotBalances('0x0000000000000000000000000000000000000001');
    expect(balances).toEqual([{ coin: 'USDC', total: 100, hold: 5, available: 95 }]);
  });

  it('parses open orders', async () => {
    const client = new HyperliquidClient('testnet');
    const orders = await client.getOpenOrders('0x0000000000000000000000000000000000000001');
    expect(orders).toHaveLength(2);
    expect(orders[0].side).toBe('buy');
    expect(orders[1].side).toBe('sell');
    expect(orders[0].oid).toBe(123);
  });

  it('builds a correctly-shaped signed perp limit order', async () => {
    const client = new HyperliquidClient('testnet');
    // Throwaway in-memory wallet — never a real key.
    const wallet = ethers.Wallet.createRandom();
    const result = await client.placePerpLimitOrder(wallet, {
      coin: 'BTC',
      isBuy: true,
      size: 0.012345,
      price: 60664.5,
    });
    expect(result.status).toBe('resting');
    expect(result.oid).toBe(999);

    const exchangeCalls = captured.filter((b: any) => b.action?.type === 'order');
    expect(exchangeCalls).toHaveLength(1);
    const req = exchangeCalls[0] as any;
    expect(req.action.orders).toHaveLength(1);
    const order = req.action.orders[0];
    expect(order.a).toBe(0); // BTC asset index
    expect(order.b).toBe(true);
    expect(order.p).toBe('60665'); // 5 sig figs
    expect(order.s).toBe('0.01235'); // rounded to 5 szDecimals
    expect(order.r).toBe(false);
    expect(order.t).toEqual({ limit: { tif: 'Gtc' } });
    expect(order.c).toMatch(/^0x[0-9a-f]{32}$/);
    // Signed L1 payload: nonce + r/s/v signature
    expect(typeof req.nonce).toBe('number');
    expect(req.signature.r).toMatch(/^0x[0-9a-f]{64}$/);
    expect(req.signature.s).toMatch(/^0x[0-9a-f]{64}$/);
    expect([27, 28]).toContain(req.signature.v);
  });

  it('verifies the order signature recovers the signing wallet', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.placePerpLimitOrder(wallet, { coin: 'ETH', isBuy: false, size: 0.5, price: 1664.75 });
    const req = captured.find((b: any) => b.action?.type === 'order') as any;

    // Rebuild the exact EIP-712 payload the SDK signed (phantom-agent
    // L1 action, domain "Exchange" / chainId 1337) and recover the signer.
    const { createL1ActionHash } = await import('@nktkas/hyperliquid/signing');
    const actionHash = createL1ActionHash({ action: req.action, nonce: req.nonce });
    const signature = `0x${req.signature.r.slice(2)}${req.signature.s.slice(2)}${req.signature.v
      .toString(16)
      .padStart(2, '0')}`;
    const recovered = ethers.verifyTypedData(
      {
        name: 'Exchange',
        version: '1',
        chainId: 1337,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
      { source: 'b', connectionId: actionHash }, // 'b' = testnet source
      signature,
    );
    expect(recovered.toLowerCase()).toBe((await wallet.getAddress()).toLowerCase());
  });

  it('signs through a signTypedData callback (no wallet object)', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    const signer = createCallbackSigner(await wallet.getAddress(), async (domain, types, value) =>
      wallet.signTypedData(domain as never, types as never, value as never),
    );
    const result = await client.placePerpLimitOrder(signer, {
      coin: 'BTC',
      isBuy: true,
      size: 0.01,
      price: 60000,
    });
    expect(result.status).toBe('resting');
    const req = captured.find((b: any) => b.action?.type === 'order') as any;
    expect(req.signature.r).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('places a market order as an IOC limit through the mid', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.placePerpMarketOrder(wallet, { coin: 'BTC', isBuy: true, size: 0.01 });
    const req = captured.find((b: any) => b.action?.type === 'order') as any;
    const order = req.action.orders[0];
    expect(order.t).toEqual({ limit: { tif: 'Ioc' } });
    // mid 60664.5 + 1% slippage = 61271.145 -> 5 sig figs 61271
    expect(order.p).toBe('61271');
  });

  it('places a TP trigger order with positionTpsl grouping', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.placeTpSlOrder(wallet, {
      coin: 'BTC',
      isBuy: false,
      size: 0.01,
      triggerPrice: 65000,
      kind: 'tp',
    });
    const req = captured.find((b: any) => b.action?.type === 'order') as any;
    const order = req.action.orders[0];
    expect(order.r).toBe(true);
    expect(order.t).toEqual({ trigger: { isMarket: true, triggerPx: '65000', tpsl: 'tp' } });
    expect(req.action.grouping).toBe('positionTpsl');
  });

  it('builds a spot order with the 10000-offset asset id', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.placeSpotLimitOrder(wallet, {
      pair: 'PURR/USDC',
      isBuy: true,
      size: 10,
      price: 0.5,
    });
    const req = captured.find((b: any) => b.action?.type === 'order') as any;
    expect(req.action.orders[0].a).toBe(10000);
    expect(req.action.orders[0].s).toBe('10');
  });

  it('cancels an order by oid', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.cancelOrder(wallet, { coin: 'BTC', oid: 123 });
    const req = captured.find((b: any) => b.action?.type === 'cancel') as any;
    expect(req.action.cancels).toEqual([{ a: 0, o: 123 }]);
    expect(req.signature.r).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('cancels all open orders', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    const count = await client.cancelAllOrders(wallet, '0x0000000000000000000000000000000000000001');
    expect(count).toBe(2);
    const req = captured.find((b: any) => b.action?.type === 'cancel') as any;
    expect(req.action.cancels).toEqual([
      { a: 0, o: 123 },
      { a: 1, o: 124 },
    ]);
  });

  it('enforces the 20x cap in updateLeverage before signing anything', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await expect(client.updateLeverage(wallet, { coin: 'BTC', leverage: 25 })).rejects.toMatchObject({
      code: 'invalid-order',
    });
    // Nothing was sent to the exchange.
    expect(captured.filter((b: any) => b.action?.type === 'updateLeverage')).toHaveLength(0);
  });

  it('sends updateLeverage with the validated leverage', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.updateLeverage(wallet, { coin: 'BTC', leverage: 10 });
    const req = captured.find((b: any) => b.action?.type === 'updateLeverage') as any;
    expect(req.action.asset).toBe(0);
    expect(req.action.leverage).toBe(10);
    expect(req.action.isCross).toBe(true);
  });

  it('closes a long with a reduce-only IOC sell', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    const result = await client.closePosition(wallet, {
      coin: 'BTC',
      address: '0x0000000000000000000000000000000000000001',
    });
    expect(result.status).toBe('resting');
    const req = captured.find((b: any) => b.action?.type === 'order') as any;
    const order = req.action.orders[0];
    expect(order.b).toBe(false); // sell the long
    expect(order.r).toBe(true);
    expect(order.s).toBe('0.01');
    expect(order.t).toEqual({ limit: { tif: 'Ioc' } });
  });

  it('refuses to close a position that does not exist', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await expect(
      client.closePosition(wallet, { coin: 'SOL', address: '0x0000000000000000000000000000000000000001' }),
    ).rejects.toMatchObject({ code: 'invalid-order' });
  });

  it('rejects orders for unknown markets before signing', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await expect(
      client.placePerpLimitOrder(wallet, { coin: 'DOGE', isBuy: true, size: 1, price: 0.1 }),
    ).rejects.toMatchObject({ code: 'market-not-found' });
    expect(captured.filter((b: any) => b.action)).toHaveLength(0);
  });

  it('maps an exchange order error to a typed error', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    // Swap the stub so the exchange returns an error status for orders.
    restoreFetch();
    const origFetch = global.fetch;
    global.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body as string) : {};
      captured.push(body);
      let payload: unknown;
      if (body.type === 'meta') payload = TESTNET_META;
      else if (body.type === 'allMids') payload = TESTNET_MIDS;
      else if (body.action?.type === 'order') {
        payload = { status: 'ok', response: { type: 'order', data: { statuses: [{ error: 'Insufficient margin to place order.' }] } } };
      } else payload = {};
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    try {
      await expect(
        client.placePerpLimitOrder(wallet, { coin: 'BTC', isBuy: true, size: 0.01, price: 60000 }),
      ).rejects.toMatchObject({ code: 'insufficient-margin' });
    } finally {
      global.fetch = origFetch;
    }
  });

  it('maps a network failure to the network error', async () => {
    restoreFetch();
    const origFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    try {
      const client = new HyperliquidClient('testnet');
      await expect(client.getAllMids()).rejects.toMatchObject({ code: 'network' });
    } finally {
      global.fetch = origFetch;
    }
  });

  it('validates withdraw inputs before signing', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await expect(
      client.withdraw(wallet, { destination: 'not-an-address', amount: 10 }),
    ).rejects.toMatchObject({ code: 'invalid-order' });
    await expect(
      client.withdraw(wallet, { destination: '0x0000000000000000000000000000000000000001', amount: 0 }),
    ).rejects.toMatchObject({ code: 'invalid-order' });
    expect(captured.filter((b: any) => b.action?.type === 'withdraw3')).toHaveLength(0);
  });

  it('builds a withdraw3 action with the destination and amount', async () => {
    const client = new HyperliquidClient('testnet');
    const wallet = ethers.Wallet.createRandom();
    await client.withdraw(wallet, { destination: '0x0000000000000000000000000000000000000001', amount: 10 });
    const req = captured.find((b: any) => b.action?.type === 'withdraw3') as any;
    expect(req.action.destination).toBe('0x0000000000000000000000000000000000000001');
    expect(req.action.amount).toBe('10');
    expect(req.signature.r).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('returns testnet faucet deposit info by default', () => {
    const client = new HyperliquidClient('testnet');
    const info = client.getDepositInfo();
    expect(info.method).toBe('faucet');
    expect(info.faucetUrl).toBe(HYPERLIQUID_TESTNET_FAUCET_URL);
    expect(info.instructions).toMatch(/mock USDC/);
  });

  it('returns mainnet bridge deposit info on mainnet', () => {
    const client = new HyperliquidClient('mainnet');
    const info = client.getDepositInfo();
    expect(info.method).toBe('bridge');
    expect(info.chainId).toBe(42161);
    expect(info.bridgeAddress).toBe(HYPERLIQUID_BRIDGE_ADDRESS);
    expect(info.minDepositUsdc).toBe(HYPERLIQUID_MIN_DEPOSIT_USDC);
    expect(info.instructions).toMatch(/Minimum 5 USDC/);
  });
});
